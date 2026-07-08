import { mkdir } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../shared/atomic-file.mjs";
import { toCsv } from "../shared/csv.mjs";
import {
  CASE_TIMELINE_CANDIDATES_FILENAME,
  CASE_TIMELINE_CANDIDATES_RELATIVE,
  CASE_TIMELINE_CSV_FILENAME,
  CASE_TIMELINE_CSV_RELATIVE,
  CASE_TIMELINE_JSON_FILENAME,
  CASE_TIMELINE_JSON_RELATIVE,
  CASE_TIMELINE_MARKDOWN_FILENAME,
  CASE_TIMELINE_MARKDOWN_RELATIVE,
  MATTER_LIBRARY_DIR,
} from "../shared/matter-artifacts.mjs";
import { CSV_HEADERS } from "./contracts.mjs";
import { matterSummary } from "./entries.mjs";
import { renderListOfDatesMarkdown } from "./rendering.mjs";
import { createSourceSnapshot } from "./source-records.mjs";

export const CANDIDATE_LEDGER_FILE = CASE_TIMELINE_CANDIDATES_FILENAME;

export function createListOfDatesOutputPaths(_matterRoot, { includeCandidates = false } = {}) {
  const outputPaths = {
    directory: MATTER_LIBRARY_DIR,
    json: CASE_TIMELINE_JSON_RELATIVE,
    csv: CASE_TIMELINE_CSV_RELATIVE,
    markdown: CASE_TIMELINE_MARKDOWN_RELATIVE,
  };
  if (includeCandidates) outputPaths.candidates = CASE_TIMELINE_CANDIDATES_RELATIVE;
  return outputPaths;
}

export function buildListOfDatesJson({
  matterJson,
  engineVersion,
  generatedAt = new Date().toISOString(),
  aiRun,
  records,
  sourceIndex,
  entries,
  generationMode,
  candidateLedgerPath,
  pass1AiRun,
  pass2AiRun,
  validation,
}) {
  return {
    schema_version: "list-of-dates/v1",
    engine_version: engineVersion,
    ...(generationMode ? { generation_mode: generationMode } : {}),
    ...(candidateLedgerPath ? { candidate_ledger_path: candidateLedgerPath } : {}),
    generated_at: generatedAt,
    matter: matterSummary(matterJson),
    ai_run: aiRun,
    ...(pass1AiRun ? { pass1_ai_run: pass1AiRun } : {}),
    ...(pass2AiRun ? { pass2_ai_run: pass2AiRun } : {}),
    source_record_count: records.length,
    source_snapshot: createSourceSnapshot(sourceIndex),
    ...(validation ? { validation } : {}),
    entries,
  };
}

export function buildListOfDatesArtifactFiles({
  matterJson,
  engineVersion,
  markdownEngineVersion = engineVersion,
  generatedAt,
  aiRun,
  records,
  sourceIndex,
  entries,
  generationMode,
  candidateLedgerPath,
  pass1AiRun,
  pass2AiRun,
  validation,
} = {}) {
  const outputPaths = {
    directory: MATTER_LIBRARY_DIR,
    json: CASE_TIMELINE_JSON_RELATIVE,
    csv: CASE_TIMELINE_CSV_RELATIVE,
    markdown: CASE_TIMELINE_MARKDOWN_RELATIVE,
  };
  const jsonArtifact = buildListOfDatesJson({
    matterJson,
    engineVersion,
    generatedAt,
    aiRun,
    records,
    sourceIndex,
    entries,
    generationMode,
    candidateLedgerPath,
    pass1AiRun,
    pass2AiRun,
    validation,
  });
  return {
    outputPaths,
    jsonArtifact,
    files: [
      { relativePath: outputPaths.json, text: `${JSON.stringify(jsonArtifact, null, 2)}\n` },
      { relativePath: outputPaths.csv, text: toCsv(entries, CSV_HEADERS) },
      { relativePath: outputPaths.markdown, text: renderListOfDatesMarkdown(matterJson, entries, markdownEngineVersion) },
    ],
  };
}

export async function writeListOfDatesArtifacts({
  matterRoot,
  includeCandidates = false,
  ...artifactOptions
}) {
  const outputDir = path.join(matterRoot, MATTER_LIBRARY_DIR);
  const outputPaths = createListOfDatesOutputPaths(matterRoot, { includeCandidates });
  const artifactFiles = buildListOfDatesArtifactFiles(artifactOptions);
  await mkdir(outputDir, { recursive: true });
  await writeFileAtomic(path.join(outputDir, CASE_TIMELINE_JSON_FILENAME), artifactFiles.files[0].text);
  await writeFileAtomic(path.join(outputDir, CASE_TIMELINE_CSV_FILENAME), artifactFiles.files[1].text);
  await writeFileAtomic(path.join(outputDir, CASE_TIMELINE_MARKDOWN_FILENAME), artifactFiles.files[2].text);
  return outputPaths;
}

export async function writeCandidateLedger(matterRoot, candidateLedger) {
  const outputDir = path.join(matterRoot, MATTER_LIBRARY_DIR);
  const outputPaths = createListOfDatesOutputPaths(matterRoot, { includeCandidates: true });
  await mkdir(outputDir, { recursive: true });
  await writeJsonFile(path.join(outputDir, CANDIDATE_LEDGER_FILE), candidateLedger);
  return outputPaths.candidates;
}

export async function writeJsonFile(filePath, value) {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
