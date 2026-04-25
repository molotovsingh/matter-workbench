import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import busboy from "busboy";
import { runMatterInit } from "./matter-init-engine.mjs";
import { toPosix } from "./path-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, "config.json");
let matterRoot = process.env.MATTER_ROOT ? path.resolve(process.env.MATTER_ROOT) : null;
let mattersHome = process.env.MATTERS_HOME ? path.resolve(process.env.MATTERS_HOME) : null;
if (!mattersHome) {
  try {
    const loaded = JSON.parse(await readFile(configPath, "utf8"));
    if (loaded && typeof loaded.mattersHome === "string") {
      mattersHome = path.resolve(loaded.mattersHome);
    }
  } catch {
    // No config yet; first-run will handle it.
  }
}
const port = Number(process.env.PORT || 4173);
const defaultMattersHome = path.join(os.homedir(), "Documents", "Matter Workbench");
const maxUploadBytes = 500 * 1024 * 1024;
const intakeDirName = "Intake 01 - Initial";
const maxTreeDepth = 6;
const maxChildrenPerDirectory = 160;
const maxPreviewBytes = 512 * 1024;
const hiddenMatterEntries = new Set([
  ".git",
  ".playwright-cli",
  "phase1_legal_workbench",
]);
const previewExtensions = new Set([
  ".csv",
  ".json",
  ".log",
  ".md",
  ".mjs",
  ".txt",
]);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
]);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function ensureMatterRoot() {
  if (!matterRoot) {
    const error = new Error(mattersHome
      ? "No matter is active — pick one from the sidebar or create a new one."
      : "MATTER_ROOT is not configured");
    error.statusCode = 409;
    throw error;
  }
  return matterRoot;
}

function isInsideMatterRoot(filePath) {
  const root = ensureMatterRoot();
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function isInsideMattersHome(filePath) {
  if (!mattersHome) return false;
  const resolved = path.resolve(filePath);
  return resolved === mattersHome || resolved.startsWith(`${mattersHome}${path.sep}`);
}

function validateMatterName(rawName) {
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name || name.startsWith(".") || name.includes("/") || name.includes("\\") || name.includes("..")) {
    const error = new Error("Invalid matter name");
    error.statusCode = 400;
    throw error;
  }
  return name;
}

function validateRelativePath(rawPath) {
  const value = typeof rawPath === "string" ? rawPath : "";
  if (!value) {
    const error = new Error("Empty file path");
    error.statusCode = 400;
    throw error;
  }
  if (value.startsWith("/") || value.startsWith("\\") || /^[a-zA-Z]:/.test(value)) {
    const error = new Error("Absolute paths not allowed");
    error.statusCode = 400;
    throw error;
  }
  const segments = value.split(/[\\/]+/);
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || segment.includes("\0")) {
      const error = new Error(`Invalid path segment in ${value}`);
      error.statusCode = 400;
      throw error;
    }
  }
  return segments.join("/");
}

function activeMatterNameWithinHome() {
  if (!matterRoot || !mattersHome) return null;
  if (!isInsideMattersHome(matterRoot)) return null;
  if (path.dirname(matterRoot) !== mattersHome) return null;
  return path.basename(matterRoot);
}

function parseCsvRow(line) {
  const cells = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else if (ch === '"' && cell === "") {
      inQuotes = true;
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

async function extractRegisterHashes(matterFolderName) {
  if (!mattersHome) return new Set();
  const registerPath = path.join(mattersHome, matterFolderName, "00_Inbox", "Intake 01 - Initial", "File Register.csv");
  try {
    const text = await readFile(registerPath, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return new Set();
    const header = parseCsvRow(lines[0]);
    const hashIndex = header.indexOf("sha256");
    if (hashIndex === -1) return new Set();
    const hashes = new Set();
    for (let i = 1; i < lines.length; i += 1) {
      const cells = parseCsvRow(lines[i]);
      const hash = cells[hashIndex];
      if (hash) hashes.add(hash);
    }
    return hashes;
  } catch {
    return new Set();
  }
}

async function listIntakeFolders(matterPath) {
  const inboxPath = path.join(matterPath, "00_Inbox");
  try {
    const entries = await readdir(inboxPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^Intake (\d{2,})\b/.test(entry.name))
      .map((entry) => {
        const match = entry.name.match(/^Intake (\d{2,})/);
        return { name: entry.name, intakeNumber: parseInt(match[1], 10) };
      })
      .sort((a, b) => a.intakeNumber - b.intakeNumber);
  } catch {
    return [];
  }
}

async function nextIntakeNumber(matterPath) {
  const folders = await listIntakeFolders(matterPath);
  if (!folders.length) return 1;
  return folders[folders.length - 1].intakeNumber + 1;
}

async function nextFileIdStart(matterPath) {
  const folders = await listIntakeFolders(matterPath);
  let max = 0;
  for (const folder of folders) {
    const registerPath = path.join(matterPath, "00_Inbox", folder.name, "File Register.csv");
    try {
      const text = await readFile(registerPath, "utf8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) continue;
      const header = parseCsvRow(lines[0]);
      const idIndex = header.indexOf("file_id");
      if (idIndex === -1) continue;
      for (let i = 1; i < lines.length; i += 1) {
        const cells = parseCsvRow(lines[i]);
        const m = (cells[idIndex] || "").match(/FILE-(\d+)/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > max) max = n;
        }
      }
    } catch {
      // ignore
    }
  }
  return max + 1;
}

async function priorHashIndex(matterPath) {
  const folders = await listIntakeFolders(matterPath);
  const index = new Map();
  for (const folder of folders) {
    const registerPath = path.join(matterPath, "00_Inbox", folder.name, "File Register.csv");
    try {
      const text = await readFile(registerPath, "utf8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) continue;
      const header = parseCsvRow(lines[0]);
      const idIndex = header.indexOf("file_id");
      const hashIndex = header.indexOf("sha256");
      const statusIndex = header.indexOf("status");
      if (idIndex === -1 || hashIndex === -1) continue;
      for (let i = 1; i < lines.length; i += 1) {
        const cells = parseCsvRow(lines[i]);
        const hash = cells[hashIndex];
        const fileId = cells[idIndex];
        const status = cells[statusIndex] || "";
        if (!hash || !fileId) continue;
        if (status === "duplicate-of-prior-intake") continue;
        if (!index.has(hash)) index.set(hash, fileId);
      }
    } catch {
      // ignore
    }
  }
  return index;
}

function validateLabel(rawLabel) {
  const label = typeof rawLabel === "string" ? rawLabel.trim() : "";
  if (!label) return "";
  if (label.length > 80) {
    const error = new Error("Label too long (max 80 chars)");
    error.statusCode = 400;
    throw error;
  }
  if (!/^[A-Za-z0-9 _-]+$/.test(label)) {
    const error = new Error("Label may contain only letters, numbers, spaces, hyphens, underscores");
    error.statusCode = 400;
    throw error;
  }
  return label;
}

function composeIntakeDirName(number, label, dateIso) {
  const padded = String(number).padStart(2, "0");
  if (number === 1 && !label) return "Intake 01 - Initial";
  const suffix = label ? `${dateIso} ${label}` : dateIso;
  return `Intake ${padded} - ${suffix}`;
}

async function listMattersHomeChildren() {
  if (!mattersHome) return [];
  try {
    const entries = await readdir(mattersHome, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => ({ name: entry.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function saveConfig() {
  await writeFile(configPath, `${JSON.stringify({ mattersHome }, null, 2)}\n`);
}

function resolveMatterPath(relativePath = "") {
  const root = ensureMatterRoot();
  const resolved = path.resolve(root, relativePath);
  if (!isInsideMatterRoot(resolved)) {
    const error = new Error("Requested path is outside the matter root");
    error.statusCode = 403;
    throw error;
  }
  return resolved;
}

function toMatterRelative(filePath) {
  return toPosix(path.relative(ensureMatterRoot(), filePath));
}

function isVisibleMatterEntry(entry, depth, scanContext = {}) {
  const name = entry.name;
  if (name.startsWith(".")) return false;
  if (depth === 0 && hiddenMatterEntries.has(name)) return false;
  if (
    depth === 0
    && entry.isFile()
    && name !== "matter.json"
    && scanContext.hideStagedRootSourceFiles
    && scanContext.stagedSourceFileNames.has(name)
  ) {
    return false;
  }
  return true;
}

function normalizeMatterMetadata(rawMatter) {
  return {
    clientName: rawMatter.client_name || "",
    matterName: rawMatter.matter_name || "",
    oppositeParty: rawMatter.opposite_party || "",
    matterType: rawMatter.matter_type || "",
    jurisdiction: rawMatter.jurisdiction || "",
    briefDescription: rawMatter.brief_description || "",
  };
}

async function readMatterMetadata() {
  const root = ensureMatterRoot();
  try {
    const rawMatter = JSON.parse(await readFile(path.join(root, "matter.json"), "utf8"));
    return normalizeMatterMetadata(rawMatter);
  } catch {
    return {
      clientName: "",
      matterName: path.basename(root),
      oppositeParty: "",
      matterType: "",
      jurisdiction: "",
      briefDescription: "",
    };
  }
}

async function readPhase1Intake(root) {
  try {
    const rawMatter = JSON.parse(await readFile(path.join(root, "matter.json"), "utf8"));
    return rawMatter.phase_1_intake || null;
  } catch {
    return null;
  }
}

async function readStagedSourceFileNames(root, phase1Intake) {
  const sourceDir = path.join(root, "00_Inbox", intakeDirName, "Source Files");
  const names = new Set(
    (phase1Intake?.loose_root_source_files || [])
      .map((file) => path.basename(file.source_path || ""))
      .filter(Boolean),
  );

  try {
    const entries = await readdir(sourceDir, { withFileTypes: true });
    entries
      .filter((entry) => entry.isFile())
      .forEach((entry) => names.add(entry.name));
    return names;
  } catch {
    return names;
  }
}

async function scanMatterTree(root, depth = 0, scanContext = {}) {
  const directoryEntries = await readdir(root, { withFileTypes: true });
  const visibleEntries = directoryEntries
    .filter((entry) => isVisibleMatterEntry(entry, depth, scanContext))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const children = [];
  let fileCount = 0;
  let directoryCount = 0;

  for (const entry of visibleEntries.slice(0, maxChildrenPerDirectory)) {
    const absolutePath = path.join(root, entry.name);
    const relativePath = toMatterRelative(absolutePath);

    if (entry.isDirectory()) {
      directoryCount += 1;
      const childNode = {
        name: entry.name,
        kind: "directory",
        path: relativePath,
        children: [],
      };

      if (depth < maxTreeDepth) {
        const childScan = await scanMatterTree(absolutePath, depth + 1, scanContext);
        childNode.children = childScan.children;
        fileCount += childScan.fileCount;
        directoryCount += childScan.directoryCount;
        if (childScan.truncated) childNode.truncated = true;
      }

      children.push(childNode);
      continue;
    }

    if (entry.isFile()) {
      fileCount += 1;
      const fileStat = await stat(absolutePath);
      children.push({
        name: entry.name,
        kind: "file",
        path: relativePath,
        size: fileStat.size,
        previewable: previewExtensions.has(path.extname(entry.name).toLowerCase())
          && fileStat.size <= maxPreviewBytes,
      });
    }
  }

  return {
    children,
    fileCount,
    directoryCount,
    truncated: visibleEntries.length > maxChildrenPerDirectory,
  };
}

async function readWorkspace() {
  const root = ensureMatterRoot();
  const metadata = await readMatterMetadata();
  const phase1Intake = await readPhase1Intake(root);
  const intakeExists = Boolean(phase1Intake);
  const stagedSourceFileNames = intakeExists ? await readStagedSourceFileNames(root, phase1Intake) : new Set();
  const treeScan = await scanMatterTree(root, 0, {
    hideStagedRootSourceFiles: intakeExists,
    stagedSourceFileNames,
  });

  return {
    folderName: path.basename(root),
    inputLabel: root,
    metadata,
    fileCount: treeScan.fileCount,
    directoryCount: treeScan.directoryCount,
    tree: {
      name: path.basename(root),
      kind: "directory",
      path: "",
      children: treeScan.children,
      truncated: treeScan.truncated,
    },
  };
}

async function serveWorkspace(response) {
  sendJson(response, 200, await readWorkspace());
}

async function serveFilePreview(url, response) {
  const relativePath = url.searchParams.get("path") || "";
  const filePath = resolveMatterPath(relativePath);
  const fileStat = await stat(filePath);

  if (!fileStat.isFile()) {
    sendJson(response, 400, { error: "Requested path is not a file" });
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  if (!previewExtensions.has(extension)) {
    sendJson(response, 415, { error: "File type is not previewable as text" });
    return;
  }

  if (fileStat.size > maxPreviewBytes) {
    sendJson(response, 413, { error: "File is too large to preview" });
    return;
  }

  sendJson(response, 200, {
    path: toMatterRelative(filePath),
    name: path.basename(filePath),
    content: await readFile(filePath, "utf8"),
  });
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function handleNewMatterUpload(request) {
  return new Promise((resolve, reject) => {
    const contentType = request.headers["content-type"] || "";
    if (!contentType.startsWith("multipart/form-data")) {
      const error = new Error("Expected multipart/form-data");
      error.statusCode = 400;
      reject(error);
      return;
    }

    const bb = busboy({
      headers: request.headers,
      limits: { fileSize: maxUploadBytes, files: 5000, fields: 20 },
    });

    const fields = {};
    const filePromises = [];
    let totalBytes = 0;
    let fileIndex = 0;
    let aborted = false;

    const fail = (error) => {
      if (aborted) return;
      aborted = true;
      request.unpipe(bb);
      reject(error);
    };

    bb.on("field", (name, value) => {
      fields[name] = value;
    });

    bb.on("file", (fieldname, fileStream, info) => {
      if (aborted) {
        fileStream.resume();
        return;
      }
      const currentIndex = fileIndex;
      fileIndex += 1;
      filePromises.push(new Promise((resolveFile, rejectFile) => {
        const chunks = [];
        let streamBytes = 0;
        fileStream.on("data", (chunk) => {
          streamBytes += chunk.length;
          totalBytes += chunk.length;
          if (totalBytes > maxUploadBytes) {
            const error = new Error("Upload too large");
            error.statusCode = 413;
            rejectFile(error);
            fail(error);
            return;
          }
          chunks.push(chunk);
        });
        fileStream.on("limit", () => {
          const error = new Error("Upload too large");
          error.statusCode = 413;
          rejectFile(error);
          fail(error);
        });
        fileStream.on("error", rejectFile);
        fileStream.on("end", () => resolveFile({
          index: currentIndex,
          filename: info.filename,
          buffer: Buffer.concat(chunks),
          bytes: streamBytes,
        }));
      }));
    });

    bb.on("filesLimit", () => fail(Object.assign(new Error("Too many files"), { statusCode: 413 })));
    bb.on("error", fail);
    bb.on("finish", async () => {
      if (aborted) return;
      try {
        const files = await Promise.all(filePromises);
        resolve({ fields, files });
      } catch (error) {
        reject(error);
      }
    });

    request.pipe(bb);
  });
}

async function createMatter(request) {
  if (!mattersHome) {
    const error = new Error("Matters home is not configured");
    error.statusCode = 409;
    throw error;
  }

  const { fields, files } = await handleNewMatterUpload(request);
  const name = validateMatterName(fields.name);
  const matterPath = path.join(mattersHome, name);
  if (!isInsideMattersHome(matterPath) || path.dirname(matterPath) !== mattersHome) {
    const error = new Error("Invalid matter path");
    error.statusCode = 400;
    throw error;
  }

  const siblings = await listMattersHomeChildren();
  const collision = siblings.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  if (collision) {
    const error = new Error(`A matter named "${collision.name}" already exists`);
    error.statusCode = 409;
    throw error;
  }

  try {
    await stat(matterPath);
    const error = new Error("A matter with this name already exists");
    error.statusCode = 409;
    throw error;
  } catch (cause) {
    if (cause.statusCode) throw cause;
    if (cause.code !== "ENOENT") throw cause;
  }

  let metadata = {};
  if (fields.metadata) {
    try {
      metadata = JSON.parse(fields.metadata);
    } catch {
      const error = new Error("Invalid metadata JSON");
      error.statusCode = 400;
      throw error;
    }
  }

  let relativePaths = [];
  if (fields.paths) {
    try {
      relativePaths = JSON.parse(fields.paths);
    } catch {
      const error = new Error("Invalid paths JSON");
      error.statusCode = 400;
      throw error;
    }
  }
  if (!Array.isArray(relativePaths) || relativePaths.length !== files.length) {
    const error = new Error("paths array must match file count");
    error.statusCode = 400;
    throw error;
  }

  const evidenceDir = path.join(matterPath, "00_Inbox", "Intake 01 - Initial", "Source Files");
  await mkdir(evidenceDir, { recursive: true });

  for (const file of files.sort((a, b) => a.index - b.index)) {
    const safeRel = validateRelativePath(relativePaths[file.index]);
    const destination = path.resolve(evidenceDir, safeRel);
    if (!destination.startsWith(`${evidenceDir}${path.sep}`)) {
      const error = new Error("Resolved destination escapes matter root");
      error.statusCode = 400;
      throw error;
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await new Promise((resolve, reject) => {
      const stream = createWriteStream(destination);
      stream.on("error", reject);
      stream.on("finish", resolve);
      stream.end(file.buffer);
    });
  }

  matterRoot = matterPath;
  await runMatterInit({ matterRoot, metadata, dryRun: false });
  return readWorkspace();
}

async function addFilesToMatter(request) {
  const root = ensureMatterRoot();
  const { fields, files } = await handleNewMatterUpload(request);
  const label = validateLabel(fields.label);

  let relativePaths = [];
  if (fields.paths) {
    try {
      relativePaths = JSON.parse(fields.paths);
    } catch {
      const error = new Error("Invalid paths JSON");
      error.statusCode = 400;
      throw error;
    }
  }
  if (!Array.isArray(relativePaths) || relativePaths.length !== files.length) {
    const error = new Error("paths array must match file count");
    error.statusCode = 400;
    throw error;
  }
  if (!files.length) {
    const error = new Error("No files attached");
    error.statusCode = 400;
    throw error;
  }

  const intakeNumber = await nextIntakeNumber(root);
  const fileIdStart = await nextFileIdStart(root);
  const priorHashes = await priorHashIndex(root);
  const receivedDate = new Date().toISOString().slice(0, 10);
  const intakeDirName = composeIntakeDirName(intakeNumber, label, receivedDate);
  const intakeId = `INTAKE-${String(intakeNumber).padStart(2, "0")}`;
  const intakeDirPath = path.join(root, "00_Inbox", intakeDirName);
  if (!intakeDirPath.startsWith(`${root}${path.sep}`)) {
    const error = new Error("Resolved intake path escapes matter root");
    error.statusCode = 400;
    throw error;
  }
  const sourceFilesDir = path.join(intakeDirPath, "Source Files");
  await mkdir(sourceFilesDir, { recursive: true });

  for (const file of files.sort((a, b) => a.index - b.index)) {
    const safeRel = validateRelativePath(relativePaths[file.index]);
    const destination = path.resolve(sourceFilesDir, safeRel);
    if (!destination.startsWith(`${sourceFilesDir}${path.sep}`)) {
      const error = new Error("Resolved destination escapes intake root");
      error.statusCode = 400;
      throw error;
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await new Promise((resolve, reject) => {
      const stream = createWriteStream(destination);
      stream.on("error", reject);
      stream.on("finish", resolve);
      stream.end(file.buffer);
    });
  }

  const existing = await readExistingMatterMetadata(root);
  const result = await runMatterInit({
    matterRoot: root,
    metadata: existing,
    dryRun: false,
    intakeId,
    intakeDirName,
    intakeLabel: label,
    receivedDate,
    fileIdStart,
    priorHashes,
  });

  const workspace = await readWorkspace();
  return {
    ...workspace,
    intakeAdded: {
      intakeId,
      intakeDirName,
      receivedDate,
      label,
      scanned: result.counts.scannedFiles,
      unique: result.counts.uniqueFiles,
      duplicatesInBatch: result.counts.duplicatesInBatch,
      duplicatesOfPrior: result.counts.duplicatesOfPrior,
    },
  };
}

async function readExistingMatterMetadata(matterRoot) {
  try {
    const raw = JSON.parse(await readFile(path.join(matterRoot, "matter.json"), "utf8"));
    return {
      matterName: raw.matter_name || "",
      matterType: raw.matter_type || "",
      clientName: raw.client_name || "",
      oppositeParty: raw.opposite_party || "",
      jurisdiction: raw.jurisdiction || "",
      briefDescription: raw.brief_description || "",
    };
  } catch {
    return {};
  }
}

function resolveStaticPath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const relativePath = cleanPath === "/" ? "index.html" : cleanPath.replace(/^\/+/, "");
  const absolutePath = path.resolve(__dirname, relativePath);
  if (!absolutePath.startsWith(__dirname)) return null;
  return absolutePath;
}

async function serveStatic(request, response) {
  const filePath = resolveStaticPath(request.url || "/");
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "content-type": contentTypes.get(extension) || "application/octet-stream",
      "content-length": fileStat.size,
    });
    response.end(await readFile(filePath));
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

    if (request.method === "POST" && request.url === "/api/matter-init") {
      const root = ensureMatterRoot();
      const body = await readRequestJson(request);
      const result = await runMatterInit({
        matterRoot: root,
        metadata: body.metadata || {},
        dryRun: Boolean(body.dryRun),
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/config") {
      sendJson(response, 200, {
        mattersHome: mattersHome || null,
        defaultMattersHome,
        hasActiveMatter: Boolean(matterRoot),
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/config") {
      const body = await readRequestJson(request);
      if (!body.mattersHome || typeof body.mattersHome !== "string") {
        const error = new Error("mattersHome is required");
        error.statusCode = 400;
        throw error;
      }
      const resolved = path.resolve(body.mattersHome.replace(/^~(?=$|\/|\\)/, os.homedir()));
      await mkdir(resolved, { recursive: true });
      mattersHome = resolved;
      await saveConfig();
      sendJson(response, 200, { mattersHome });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/matters") {
      sendJson(response, 200, {
        enabled: Boolean(mattersHome),
        mattersHome: mattersHome || null,
        active: activeMatterNameWithinHome(),
        matters: await listMattersHomeChildren(),
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/switch-matter") {
      if (!mattersHome) {
        const error = new Error("Matters home is not configured");
        error.statusCode = 409;
        throw error;
      }
      const body = await readRequestJson(request);
      const name = validateMatterName(body.name);
      const resolved = path.join(mattersHome, name);
      if (!isInsideMattersHome(resolved) || path.dirname(resolved) !== mattersHome) {
        const error = new Error("Invalid matter name");
        error.statusCode = 400;
        throw error;
      }
      let targetStat;
      try {
        targetStat = await stat(resolved);
      } catch (cause) {
        if (cause && cause.code === "ENOENT") {
          const error = new Error("Matter not found");
          error.statusCode = 404;
          throw error;
        }
        throw cause;
      }
      if (!targetStat.isDirectory()) {
        const error = new Error("Not a directory");
        error.statusCode = 400;
        throw error;
      }
      matterRoot = resolved;
      sendJson(response, 200, await readWorkspace());
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/matters/new") {
      const workspace = await createMatter(request);
      sendJson(response, 200, workspace);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/matters/add-files") {
      const result = await addFilesToMatter(request);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/matters/check-overlap") {
      if (!mattersHome) {
        sendJson(response, 200, { warnings: [] });
        return;
      }
      const body = await readRequestJson(request);
      const incoming = Array.isArray(body.hashes)
        ? body.hashes.filter((h) => typeof h === "string" && /^[0-9a-f]{64}$/i.test(h))
        : [];
      if (!incoming.length) {
        sendJson(response, 200, { warnings: [] });
        return;
      }
      const matters = await listMattersHomeChildren();
      const warnings = [];
      for (const matter of matters) {
        const existing = await extractRegisterHashes(matter.name);
        if (!existing.size) continue;
        let overlap = 0;
        for (const hash of incoming) if (existing.has(hash)) overlap += 1;
        if (overlap === 0) continue;
        warnings.push({
          matterName: matter.name,
          overlapCount: overlap,
          totalIncoming: incoming.length,
          matterTotalFiles: existing.size,
          overlapPercent: Math.round((overlap / incoming.length) * 100),
        });
      }
      warnings.sort((a, b) => b.overlapPercent - a.overlapPercent);
      sendJson(response, 200, { warnings });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/workspace") {
      await serveWorkspace(response);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/file") {
      await serveFilePreview(requestUrl, response);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(request, response);
      return;
    }

    response.writeHead(405);
    response.end("Method not allowed");
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

server.listen(port, () => {
  console.log(`Legal Workbench running at http://127.0.0.1:${port}/`);
  if (mattersHome) console.log(`Matters home: ${mattersHome}`);
  console.log(matterRoot
    ? `Matter root: ${matterRoot}`
    : mattersHome
      ? "Matter root: none — pick or create a matter in the sidebar."
      : "Matter root: not configured. Open http://127.0.0.1:4173/ to set matters home on first run.");
});
