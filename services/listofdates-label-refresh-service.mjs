import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../shared/atomic-file.mjs";
import { renderListOfDatesMarkdown } from "../create-listofdates-engine.mjs";
import { toCsv } from "../shared/csv.mjs";
import {
  CASE_TIMELINE_CSV_RELATIVE,
  CASE_TIMELINE_JSON_RELATIVE,
  CASE_TIMELINE_JSON_RELATIVE_CANDIDATES,
  CASE_TIMELINE_MARKDOWN_RELATIVE,
  MATTER_LIBRARY_DIR,
  SOURCE_INDEX_RELATIVE,
} from "../shared/matter-artifacts.mjs";
import {
  normalizeSourceLabelText,
  sourceLabelMetadata,
} from "../shared/source-labels.mjs";

export const LIST_OF_DATES_CSV_HEADERS = [
  "date_iso",
  "date_text",
  "event",
  "event_type",
  "legal_relevance",
  "issue_tags",
  "perspective",
  "cluster_id",
  "cluster_type",
  "supporting_citations",
  "citation",
  "source_file_id",
  "source_id",
  "content_hash",
  "source_label",
  "source_short_label",
  "file_id",
  "source_path",
  "page",
  "block_id",
  "needs_review",
  "confidence",
];

export async function refreshListOfDatesSourceLabels(options = {}) {
  const matterRoot = options.matterRoot
    ? path.resolve(options.matterRoot)
    : (process.env.MATTER_ROOT ? path.resolve(process.env.MATTER_ROOT) : null);
  if (!matterRoot) throw new Error("MATTER_ROOT is not set. Pass options.matterRoot or set the env var.");

  const dryRun = Boolean(options.dryRun);
  const outputDir = path.join(matterRoot, MATTER_LIBRARY_DIR);
  const listJson = await readFirstListOfDatesArtifact(matterRoot, CASE_TIMELINE_JSON_RELATIVE_CANDIDATES);
  const sourceIndex = await readSourceIndexArtifact(path.join(matterRoot, SOURCE_INDEX_RELATIVE));
  const matterJson = await readMatterJson(matterRoot);
  const { response, files } = buildListOfDatesSourceLabelRefresh({
    matterRoot,
    matterJson,
    listJson,
    sourceIndex,
    dryRun,
    generatedAt: options.generatedAt,
  });

  if (!dryRun) {
    await mkdir(outputDir, { recursive: true });
    for (const file of files) {
      const filePath = path.join(matterRoot, ...file.relativePath.split("/"));
      if (file.kind === "json") await writeJsonFile(filePath, file.json);
      else await writeFileAtomic(filePath, file.text);
    }
  }

  return response;
}

export function buildListOfDatesSourceLabelRefresh({
  matterRoot = "",
  matterJson = {},
  listJson = {},
  sourceIndex = {},
  dryRun = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  validateListOfDatesArtifact(listJson);
  validateSourceIndexArtifact(sourceIndex);
  const labelIndex = buildLabelRefreshIndex({
    snapshot: listJson.source_snapshot,
    sourceIndex,
  });
  const refresh = refreshListEntries({
    entries: listJson.entries,
    labelIndex,
  });
  const refreshedSnapshot = refreshSourceSnapshotLabels(listJson.source_snapshot, labelIndex);
  const engineVersion = listJson.engine_version || "create-listofdates-v1-ai";
  const nextJson = {
    ...listJson,
    label_refreshed_at: generatedAt,
    source_snapshot: refreshedSnapshot,
    entries: refresh.entries,
  };
  const csvText = toCsv(refresh.entries, LIST_OF_DATES_CSV_HEADERS);
  const markdownText = renderListOfDatesMarkdown(matterJson, refresh.entries, engineVersion);
  const outputPaths = {
    directory: MATTER_LIBRARY_DIR,
    json: CASE_TIMELINE_JSON_RELATIVE,
    csv: CASE_TIMELINE_CSV_RELATIVE,
    markdown: CASE_TIMELINE_MARKDOWN_RELATIVE,
  };
  const outputLines = [
    `> workbench.run /create_case_timeline --refresh-labels${dryRun ? " (dry-run)" : ""}`,
    `[listofdates] read ${CASE_TIMELINE_JSON_RELATIVE}`,
    `[listofdates] checked ${labelIndex.size} source label record(s) without calling an AI provider`,
    `[listofdates] refreshed ${refresh.refreshedEntries} chronology row label(s)`,
  ];
  if (refresh.refreshedSupportingSources) {
    outputLines.push(`[listofdates] refreshed ${refresh.refreshedSupportingSources} supporting source label(s)`);
  }
  outputLines.push(dryRun
    ? "[listofdates] dry run only. Re-run with apply to refresh labels."
    : `[listofdates] wrote ${outputPaths.json}, ${outputPaths.csv}, ${outputPaths.markdown}`);

  return {
    response: {
      dryRun,
      matterRoot,
      engineVersion,
      refreshMode: "label_refresh",
      counts: {
        recordsRead: listJson.source_record_count || 0,
        blocksSent: 0,
        blocksFiltered: 0,
        aiRequests: 0,
        candidateEntries: 0,
        acceptedEntries: refresh.entries.length,
        clusteredEntries: 0,
        entries: refresh.entries.length,
        rejectedEntries: 0,
        refreshedEntries: refresh.refreshedEntries,
        refreshedSupportingSources: refresh.refreshedSupportingSources,
      },
      outputPaths,
      entries: refresh.entries,
      outputLines,
    },
    files: [
      { relativePath: outputPaths.json, kind: "json", json: nextJson, text: `${JSON.stringify(nextJson, null, 2)}\n` },
      { relativePath: outputPaths.csv, kind: "csv", text: csvText },
      { relativePath: outputPaths.markdown, kind: "markdown", text: markdownText },
    ],
  };
}

async function readMatterJson(matterRoot) {
  const matterJsonPath = path.join(matterRoot, "matter.json");
  try {
    return JSON.parse(await readFile(matterJsonPath, "utf8"));
  } catch (error) {
    throw new Error(`matter.json not found or invalid at ${matterJsonPath}. Run /matter-init first. (${error.message})`);
  }
}

async function readFirstListOfDatesArtifact(matterRoot, relativePaths = []) {
  let lastError = null;
  for (const relativePath of relativePaths) {
    try {
      return await readListOfDatesArtifact(path.join(matterRoot, relativePath));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Case Timeline artifact is missing. Run /create_case_timeline first.");
}

async function readListOfDatesArtifact(filePath) {
  let artifact;
  try {
    artifact = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    const wrapped = new Error(`Case Timeline artifact is missing or invalid at ${filePath}. Run /create_case_timeline first. (${error.message})`);
    wrapped.statusCode = 404;
    throw wrapped;
  }
  validateListOfDatesArtifact(artifact);
  return artifact;
}

async function readSourceIndexArtifact(filePath) {
  let artifact;
  try {
    artifact = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    const wrapped = new Error(`Source Index artifact is missing or invalid at ${filePath}. Run /describe_sources first. (${error.message})`);
    wrapped.statusCode = 404;
    throw wrapped;
  }
  validateSourceIndexArtifact(artifact);
  return artifact;
}

function validateListOfDatesArtifact(artifact) {
  if (artifact?.schema_version !== "list-of-dates/v1" || !Array.isArray(artifact.entries)) {
    const error = new Error("Case Timeline artifact is not a supported list-of-dates/v1 JSON file.");
    error.statusCode = 400;
    throw error;
  }
}

function validateSourceIndexArtifact(artifact) {
  if (artifact?.schema_version !== "source-index/v1" || !Array.isArray(artifact.sources)) {
    const error = new Error("Source Index artifact is not a supported source-index/v1 JSON file.");
    error.statusCode = 400;
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function buildLabelRefreshIndex({ snapshot, sourceIndex }) {
  if (!Array.isArray(snapshot) || !snapshot.length) {
    throwLabelRefreshUnsafe("Case Timeline has no source snapshot. Regenerate the chronology before refreshing labels.");
  }
  const snapshotByFileId = new Map(snapshot.map((source) => [source.file_id, normalizeRefreshSnapshotSource(source)]));
  const snapshotIds = new Set(snapshotByFileId.keys());
  const labelIndex = new Map();

  for (const source of sourceIndex.sources) {
    if (!source?.file_id) continue;
    const previous = snapshotByFileId.get(source.file_id);
    if (!previous) {
      throwLabelRefreshUnsafe("Source Index includes documents that were not part of the current Case Timeline. Regenerate the chronology.");
    }
    const current = normalizeRefreshSnapshotSource(source);
    if ((previous.content_hash || "") !== (current.content_hash || "")) {
      throwLabelRefreshUnsafe("A source document changed. Regenerate the chronology instead of refreshing labels.");
    }
    if (
      (previous.document_type || "") !== (current.document_type || "")
      || (previous.document_date || "") !== (current.document_date || "")
      || Boolean(previous.needs_review) !== Boolean(current.needs_review)
    ) {
      throwLabelRefreshUnsafe("Source metadata changed in a way that may affect chronology judgment. Review or regenerate the chronology.");
    }
    labelIndex.set(source.file_id, sourceLabelMetadataFromSourceIndexSource(source));
  }

  for (const snapshotId of snapshotIds) {
    if (!labelIndex.has(snapshotId)) {
      throwLabelRefreshUnsafe("Source Index is missing a source used by the current Case Timeline. Regenerate the chronology.");
    }
  }

  return labelIndex;
}

function sourceLabelMetadataFromSourceIndexSource(source) {
  return {
    file_id: source.file_id || "",
    ...sourceLabelMetadata(source),
  };
}

function normalizeRefreshSnapshotSource(source = {}) {
  return {
    file_id: source.file_id || "",
    content_hash: source.content_hash || source.sha256 || "",
    document_type: normalizeSourceLabelText(source.document_type).toLowerCase(),
    document_date: normalizeSourceLabelText(source.document_date),
    needs_review: Boolean(source.needs_review),
  };
}

function refreshListEntries({ entries, labelIndex }) {
  if (!Array.isArray(entries)) return { entries: [], refreshedEntries: 0, refreshedSupportingSources: 0 };
  let refreshedEntries = 0;
  let refreshedSupportingSources = 0;
  const refreshed = entries.map((entry) => {
    const updatedEntry = applySourceLabelsToRecord(entry, labelIndex, { strictHash: true });
    if (sourceLabelSignature(updatedEntry) !== sourceLabelSignature(entry)) refreshedEntries += 1;
    const supportingSources = Array.isArray(entry.supporting_sources)
      ? entry.supporting_sources.map((source) => {
        const updatedSource = applySourceLabelsToRecord(source, labelIndex, { strictHash: false });
        if (sourceLabelSignature(updatedSource) !== sourceLabelSignature(source)) refreshedSupportingSources += 1;
        return updatedSource;
      })
      : entry.supporting_sources;
    return Array.isArray(supportingSources)
      ? { ...updatedEntry, supporting_sources: supportingSources }
      : updatedEntry;
  });
  return {
    entries: refreshed,
    refreshedEntries,
    refreshedSupportingSources,
  };
}

function applySourceLabelsToRecord(record = {}, labelIndex, { strictHash }) {
  const fileId = sourceFileIdForRecord(record);
  const metadata = fileId ? labelIndex.get(fileId) : null;
  if (!metadata) return { ...record };
  if (strictHash && record.content_hash && metadata.content_hash && record.content_hash !== metadata.content_hash) {
    throwLabelRefreshUnsafe("A Case Timeline row points to an older source hash. Regenerate the chronology.");
  }
  const next = { ...record };
  for (const key of [
    "source_id",
    "content_hash",
    "document_type",
    "document_date",
    "label_status",
    "label_revision",
  ]) {
    if (metadata[key] !== undefined && metadata[key] !== "") next[key] = metadata[key];
  }
  if (metadata.source_label) {
    next.source_label = metadata.source_label;
  } else {
    delete next.source_label;
  }
  if (metadata.source_short_label) {
    next.source_short_label = metadata.source_short_label;
  } else {
    delete next.source_short_label;
  }
  return next;
}

function refreshSourceSnapshotLabels(snapshot, labelIndex) {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.map((source) => {
    const metadata = source?.file_id ? labelIndex.get(source.file_id) : null;
    if (!metadata) return source;
    return {
      ...source,
      source_id: metadata.source_id || source.source_id || source.file_id,
      content_hash: metadata.content_hash || source.content_hash || "",
      source_label: metadata.source_label || "",
      source_short_label: metadata.source_short_label || "",
      document_type: metadata.document_type || "",
      document_date: metadata.document_date || "",
      needs_review: Boolean(metadata.needs_review),
      label_status: metadata.label_status || "",
      label_revision: Number.isInteger(metadata.label_revision) ? metadata.label_revision : 0,
    };
  });
}

function sourceFileIdForRecord(record = {}) {
  if (record.source_file_id) return record.source_file_id;
  if (record.file_id) return record.file_id;
  const citationMatch = String(record.citation || "").match(/\b(FILE-\d{4,})\b/);
  return citationMatch?.[1] || "";
}

function sourceLabelSignature(record = {}) {
  return [
    record.source_id || "",
    record.content_hash || "",
    record.source_label || "",
    record.source_short_label || "",
    record.label_status || "",
    Number.isInteger(record.label_revision) ? record.label_revision : "",
  ].join("|");
}

function throwLabelRefreshUnsafe(message) {
  const error = new Error(message);
  error.statusCode = 409;
  throw error;
}
