import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { atomicWriteFile, atomicWriteJson, readJson, safeId } from "./util.mjs";

export const PDFEVAL_SESSION_SCHEMA = "page-extract-v3/pdfeval-session-v1";
export const PDFEVAL_EXPORT_SCHEMA = "page-extract-v3/pdfeval-export-v1";

export async function createPdfevalSession({
  pdfRoot,
  caseListFile,
  v2Root,
  sessionId = "pdfeval-gold30",
  onProgress = () => {},
} = {}) {
  if (!pdfRoot || !caseListFile || !v2Root) throw new Error("PDFEval PDF root, case list, and V2-shaped root are required");
  const id = safeId(sessionId, "session id");
  const root = path.resolve(v2Root);
  const sessionRoot = path.join(root, "sessions", id);
  const objectRoot = path.join(sessionRoot, "objects");
  await mkdir(objectRoot, { recursive: true, mode: 0o700 });
  const cases = parsePdfevalCaseList(await readFile(path.resolve(caseListFile), "utf8"));
  const files = [];

  for (let index = 0; index < cases.length; index += 1) {
    const entry = cases[index];
    const sourcePath = path.join(path.resolve(pdfRoot), entry.era, `${entry.caseId}.pdf`);
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile()) throw new Error(`PDFEval source is not a file: ${entry.era}/${entry.caseId}.pdf`);
    const sourceSha256 = await sha256File(sourcePath);
    const objectPath = path.join(objectRoot, `${padIndex(index)}.blob`);
    const existing = await fileMatches(objectPath, sourceStat.size, sourceSha256);
    if (!existing) await copyAtomic(sourcePath, objectPath, sourceSha256);
    files.push({
      index,
      relativePath: `${entry.era}/${entry.caseId}.pdf`,
      expectedBytes: sourceStat.size,
      receivedBytes: sourceStat.size,
      sha256: sourceSha256,
      sourceKind: "real",
      commitDisposition: "ready",
      mimeType: "application/pdf",
    });
    onProgress({ completedFiles: index + 1, attemptedFiles: cases.length, resumed: existing });
  }

  const session = {
    schemaVersion: PDFEVAL_SESSION_SCHEMA,
    id,
    source: {
      corpus: "pdf-extraction-eval",
      caseList: path.basename(caseListFile),
    },
    state: "committed",
    files,
  };
  await atomicWriteJson(path.join(sessionRoot, "session.json"), session);
  return {
    sessionId: id,
    sessionRoot,
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.expectedBytes, 0),
  };
}

export async function exportPdfevalCandidateText({
  v2Root,
  sessionId = "pdfeval-gold30",
  routePlanFile,
  candidateRoot,
  candidateId,
  outDir,
} = {}) {
  if (!v2Root || !routePlanFile || !candidateRoot || !candidateId || !outDir) {
    throw new Error("session root, route plan, candidate root/id, and output directory are required");
  }
  const id = safeId(sessionId, "session id");
  const candidate = safeId(candidateId, "candidate id");
  const session = await readJson(path.join(path.resolve(v2Root), "sessions", id, "session.json"));
  const plan = await readJson(path.resolve(routePlanFile));
  if (plan.source?.sessionId !== id) throw new Error("route plan session does not match PDFEval session");
  const files = new Map(session.files.map((file) => [Number(file.index), file]));
  const destination = path.resolve(outDir);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const exported = [];

  for (const document of plan.documents.filter((value) => value.status === "inspected")) {
    const source = files.get(Number(document.sourceIndex));
    if (!source || source.sha256 !== document.sourceSha256) throw new Error(`source mismatch for ${document.documentId}`);
    const caseId = safeCaseId(path.basename(source.relativePath, path.extname(source.relativePath)));
    const documentId = safeId(document.documentId, "document id");
    const sourceText = path.join(path.resolve(candidateRoot), "candidates", candidate, "outputs", `${documentId}.txt`);
    const text = await readFile(sourceText, "utf8");
    if (!text.trim()) throw new Error(`empty V3 output for ${caseId}`);
    const target = path.join(destination, `${caseId}.txt`);
    await atomicWriteFile(target, text);
    exported.push({
      caseId,
      documentId,
      pages: document.pageCount,
      outputBytes: Buffer.byteLength(text),
    });
  }

  const manifest = {
    schemaVersion: PDFEVAL_EXPORT_SCHEMA,
    sessionId: id,
    candidateId: candidate,
    routePlanFingerprint: plan.fingerprintSha256,
    files: exported,
  };
  await atomicWriteJson(path.join(destination, "manifest.json"), manifest);
  return manifest;
}

export function parsePdfevalCaseList(text, defaultEra = "archival") {
  const entries = [];
  const seen = new Set();
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    let era;
    let caseId;
    if (line.includes(",")) [era, caseId] = line.split(",", 2).map((value) => value.trim());
    else if (line.includes("/")) [era, caseId] = line.split("/", 2).map((value) => value.trim());
    else {
      era = defaultEra;
      caseId = line;
    }
    const safeEra = safeCaseId(era);
    const safeCase = safeCaseId(caseId);
    if (seen.has(safeCase)) throw new Error(`duplicate PDFEval case id: ${safeCase}`);
    seen.add(safeCase);
    entries.push({ era: safeEra, caseId: safeCase });
  }
  if (!entries.length) throw new Error("PDFEval case list is empty");
  return entries;
}

async function copyAtomic(sourcePath, objectPath, expectedSha256) {
  const temporary = `${objectPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await copyFile(sourcePath, temporary);
    const actual = await sha256File(temporary);
    if (actual !== expectedSha256) throw new Error(`copied PDF hash mismatch for ${path.basename(sourcePath)}`);
    await rename(temporary, objectPath);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

async function fileMatches(filePath, expectedBytes, expectedSha256) {
  try {
    const value = await stat(filePath);
    return value.isFile() && value.size === expectedBytes && await sha256File(filePath) === expectedSha256;
  } catch {
    return false;
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function safeCaseId(value) {
  const result = String(value || "").trim();
  if (!result || result === "." || result === ".." || !/^[A-Za-z0-9_.-]+$/.test(result)) {
    throw new Error(`unsafe PDFEval case component: ${JSON.stringify(value)}`);
  }
  return result;
}

function padIndex(value) {
  return String(Number(value)).padStart(6, "0");
}
