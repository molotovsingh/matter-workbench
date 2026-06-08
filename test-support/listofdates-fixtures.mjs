import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runExtract } from "../extract-engine.mjs";
import { runMatterInit } from "../matter-init-engine.mjs";
import { parseCsv } from "../shared/csv.mjs";

export async function makeMatterRoot(name = "matter") {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-listofdates-test-"));
  const root = path.join(tmp, name);
  await mkdir(path.join(root, "00_Inbox", "Intake 01 - Initial", "Source Files"), { recursive: true });
  return root;
}

export async function writeSource(root, name, content) {
  const filePath = path.join(root, "00_Inbox", "Intake 01 - Initial", "Source Files", name);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

export function metadata() {
  return {
    clientName: "Mehta",
    matterName: "Mehta vs Skyline",
    oppositeParty: "Skyline",
    matterType: "Civil",
    jurisdiction: "India",
    briefDescription: "Chronology test matter",
  };
}

export async function prepareExtractedMatter() {
  const root = await makeMatterRoot();
  await writeSource(root, "facts.txt", [
    "Agreement was signed on 20 April 2026 by Mehta and Skyline.",
    "",
    "Notice was issued on 01 May 2026 after the inspection.",
  ].join("\n"));
  await runMatterInit({ matterRoot: root, metadata: metadata(), dryRun: false });
  await runExtract({ matterRoot: root, dryRun: false });
  return root;
}

export async function readExtractionRecord(root, fileId = "FILE-0001") {
  return JSON.parse(await readFile(
    path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", `${fileId}.json`),
    "utf8",
  ));
}

export async function readFileRegister(root) {
  return parseCsv(await readFile(
    path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"),
    "utf8",
  ));
}

export async function fileIdForOriginalName(root, originalName) {
  const rows = await readFileRegister(root);
  const row = rows.find((candidate) => candidate.original_name === originalName);
  assert.ok(row, `Expected File Register row for ${originalName}`);
  return row.file_id;
}

export async function writeSourceIndex(root, sources) {
  const outputDir = path.join(root, "10_Library");
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, "Source Index.json"),
    `${JSON.stringify({
      schema_version: "source-index/v1",
      generated_at: "2026-04-28T00:00:00.000Z",
      sources,
    }, null, 2)}\n`,
  );
}

export function sourceIndexSource(record, overrides = {}) {
  return {
    file_id: record.file_id,
    sha256: record.sha256,
    source_path: record.source_path,
    ...overrides,
  };
}

export function lawyerFields(overrides = {}) {
  return {
    event_type: "other",
    legal_relevance: "Supports the client's chronology because the cited source records the event.",
    issue_tags: ["chronology"],
    perspective: "client_favourable",
    ...overrides,
  };
}

export function listOfDatesEntry(overrides = {}) {
  return {
    date_iso: "2026-04-20",
    date_text: "20 April 2026",
    event: "Agreement was signed by Mehta and Skyline.",
    citation: "FILE-0001 p1.b1",
    needs_review: false,
    confidence: 0.94,
    ...lawyerFields({
      event_type: "agreement",
      legal_relevance: "Supports the client's contract chronology because the cited block records the agreement date.",
      issue_tags: ["agreement"],
    }),
    ...overrides,
  };
}

export function listOfDatesCandidate(overrides = {}) {
  return {
    date_iso: "2026-04-20",
    date_text: "20 April 2026",
    event_candidate: "Agreement was signed by Mehta and Skyline.",
    legal_materiality: "Potential foundation date for the client's contract chronology.",
    citation: "FILE-0001 p1.b1",
    source_excerpt: "Agreement was signed on 20 April 2026 by Mehta and Skyline.",
    candidate_type: "agreement",
    party_posture: "helps_client",
    same_fact_hint: "",
    date_uncertainty: "",
    ocr_suspicion: "",
    needs_review: false,
    confidence: 0.94,
    ...overrides,
  };
}
