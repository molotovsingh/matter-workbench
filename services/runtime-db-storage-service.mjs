import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import path from "node:path";
import process from "node:process";

import { psqlConnectionArgs } from "../scripts/db-psql.mjs";
import { makeHttpError, toPosix } from "../shared/safe-paths.mjs";
import { PREPARATION_STAGE_ACTIONS } from "../shared/preparation-stage-actions.mjs";
import { isBlockedWorkspacePath } from "./workspace-path-policy.mjs";

const maxPreviewBytes = 512 * 1024;
const maxRawBytes = 50 * 1024 * 1024;

const previewExtensions = new Set([
  ".csv",
  ".json",
  ".log",
  ".md",
  ".mjs",
  ".eml",
  ".txt",
]);

const embeddableExtensions = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".heic",
]);

const rawContentTypes = new Map([
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".heic", "image/heic"],
  [".csv", "text/csv; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".log", "text/plain; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".eml", "message/rfc822; charset=utf-8"],
]);

export function createRuntimeDbStorageService({
  databaseUrl = "",
  tenantId = "",
  spawn = spawnSync,
} = {}) {
  const enabled = Boolean(databaseUrl && tenantId);

  async function readWorkspace(matter) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    const result = queryJson({
      databaseUrl,
      tenantId,
      spawn,
      sql: buildWorkspaceSql({ tenantId, matter: normalizedMatter }),
    });
    const objects = Array.isArray(result.objects) ? result.objects.map(normalizeObjectRow) : [];
    const dbMatter = normalizeMatter({ ...normalizedMatter, ...(result.matter || {}) });
    const tree = buildWorkspaceTree({ matter: dbMatter, objects });
    return {
      folderName: dbMatter.name,
      inputLabel: `postgres:${dbMatter.name}`,
      metadata: {
        matterName: dbMatter.matterName || dbMatter.name,
        clientName: dbMatter.clientName,
        oppositeParty: dbMatter.oppositeParty,
        matterType: dbMatter.matterType,
        jurisdiction: dbMatter.jurisdiction,
        briefDescription: dbMatter.briefDescription,
      },
      fileCount: tree.fileCount,
      directoryCount: tree.directoryCount,
      tree: tree.root,
    };
  }

  async function readFilePreview(relativePath, matter) {
    ensureEnabled();
    const normalizedPath = normalizeMatterRelativePath(relativePath);
    const extension = path.extname(normalizedPath).toLowerCase();
    if (!previewExtensions.has(extension)) {
      throw makeHttpError("File type is not previewable as text", 415);
    }
    const payload = readPayloadRow({ matter: normalizeMatter(matter), relativePath: normalizedPath });
    if (payload.sizeBytes > maxPreviewBytes) throw makeHttpError("File is too large to preview", 413);
    return {
      path: normalizedPath,
      name: path.posix.basename(normalizedPath),
      ext: extension.replace(/^\./, ""),
      content: payload.bytes.toString("utf8"),
    };
  }

  async function getRawFile(relativePath, matter) {
    ensureEnabled();
    const normalizedPath = normalizeMatterRelativePath(relativePath);
    const payload = readPayloadRow({ matter: normalizeMatter(matter), relativePath: normalizedPath });
    if (payload.sizeBytes > maxRawBytes) throw makeHttpError("File is too large to display inline", 413);
    const extension = path.extname(normalizedPath).toLowerCase();
    return {
      contentType: payload.mimeType || rawContentTypes.get(extension) || "application/octet-stream",
      fileSize: payload.sizeBytes,
      safeFilename: path.posix.basename(normalizedPath).replace(/[\r\n"]/g, "_"),
      stream: Readable.from(payload.bytes),
    };
  }

  async function readMatterStatus(matter) {
    const normalizedMatter = normalizeMatter(matter);
    const workspace = await readWorkspace(normalizedMatter);
    const paths = workspaceFilePaths(workspace.tree);
    const stages = [
      statusStage({
        id: "matter-init",
        slash: "/matter-init",
        label: "Set Up Matter",
        present: paths.some((item) => /(^|\/)File Register\.csv$/i.test(item.path)) || Boolean(normalizedMatter.id),
        artifacts: paths.filter((item) => /(^|\/)File Register\.csv$/i.test(item.path)).map((item) => item.path),
      }),
      statusStage({
        id: "extract",
        slash: "/extract",
        label: "Extract Documents",
        present: paths.some((item) => /(^|\/)_extracted\/[^/]+\.json$/i.test(item.path)),
        artifacts: extractedArtifacts(paths),
      }),
      statusStage({
        id: "describe-sources",
        slash: "/describe_sources",
        label: "Source Labels / Document Index",
        present: paths.some((item) => item.path === "10_Library/Source Index.json"),
        artifacts: paths.filter((item) => item.path === "10_Library/Source Index.json").map((item) => item.path),
        rerunAdvice: currentAdvice("Source labels are available from DB payload custody."),
      }),
      statusStage({
        id: "create-listofdates",
        slash: "/create_listofdates",
        label: "Create List of Dates",
        present: paths.some((item) => item.path === "10_Library/List of Dates.md" || item.path === "10_Library/List of Dates.json"),
        artifacts: paths
          .filter((item) => item.path === "10_Library/List of Dates.md" || item.path === "10_Library/List of Dates.json")
          .map((item) => item.path),
        rerunAdvice: currentAdvice("List of Dates is available from DB payload custody."),
      }),
    ];
    return {
      matterRoot: `postgres:${normalizedMatter.name}`,
      matterName: normalizedMatter.name,
      stages,
    };
  }

  async function readPrepareMatterPlan(matter) {
    const normalizedMatter = normalizeMatter(matter);
    const status = await readMatterStatus(normalizedMatter);
    const stageBySlash = new Map(status.stages.map((stage) => [stage.slash, stage]));
    const setup = prepareStage("/matter-init", stageBySlash.get("/matter-init"));
    const extraction = prepareStage("/extract", stageBySlash.get("/extract"), setup);
    const sourceLabels = prepareStage("/describe_sources", stageBySlash.get("/describe_sources"), extraction);
    const listOfDates = prepareStage("/create_listofdates", stageBySlash.get("/create_listofdates"), sourceLabels);
    const stages = [setup, extraction, sourceLabels, listOfDates];
    const nextStep = stages.find((stage) => stage.action !== PREPARATION_STAGE_ACTIONS.SKIP_CURRENT);
    return {
      schema_version: "prepare-matter-plan/v1",
      matter: {
        name: normalizedMatter.matterName || normalizedMatter.name,
        folderName: normalizedMatter.name,
      },
      metadata: {
        missing: [],
        complete: true,
      },
      stages,
      downstream: {
        listOfDates,
      },
      nextStep: nextStep
        ? {
            state: nextStep.state,
            label: nextStep.label,
            message: nextStep.reason,
            stage: nextStep.id,
            slash: nextStep.slash,
          }
        : {
            state: "complete",
            label: "Core preparation is current",
            message: "Review the preparation advisory before drafting.",
            stage: "",
            slash: "",
          },
      warnings: [],
    };
  }

  async function readMatterAttention(matter) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    const result = queryJson({
      databaseUrl,
      tenantId,
      spawn,
      sql: buildAdvisorySnapshotSql({ tenantId, matter: normalizedMatter }),
    });
    if (result?.schema_version) return result;
    return emptyAttention(normalizedMatter);
  }

  function readPayloadRow({ matter, relativePath }) {
    const result = queryJson({
      databaseUrl,
      tenantId,
      spawn,
      sql: buildPayloadSql({ tenantId, matter, relativePath }),
    });
    if (!result || typeof result !== "object" || !result.objectKey) {
      throw makeHttpError("File not found in runtime database storage", 404);
    }
    if (!result.hasPayload) {
      throw makeHttpError(`Runtime DB payload is missing for ${relativePath}`, 409);
    }
    const payloadBase64 = stringValue(result.payloadBase64);
    const bytes = Buffer.from(payloadBase64, "base64");
    const sizeBytes = Number(result.sizeBytes);
    return {
      objectKey: stringValue(result.objectKey),
      mimeType: stringValue(result.mimeType),
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : bytes.length,
      bytes,
    };
  }

  function ensureEnabled() {
    if (!enabled) throw makeHttpError("Runtime DB storage is not configured", 503);
  }

  return {
    enabled,
    getRawFile,
    readMatterAttention,
    readMatterStatus,
    readPrepareMatterPlan,
    readFilePreview,
    readWorkspace,
  };
}

export function isRuntimeDbStorageModeEnabled(env = process.env) {
  return String(env.MWB_RUNTIME_DB_STORAGE || "").trim().toLowerCase() === "postgres";
}

function buildWorkspaceTree({ matter, objects }) {
  const root = {
    name: matter.name,
    kind: "directory",
    path: "",
    children: [],
  };
  let fileCount = 0;
  const directoryPaths = new Set();

  for (const object of objects) {
    const relativePath = relativePathFromObjectKey(object.objectKey, matter.name);
    if (!relativePath) continue;
    const pathParts = relativePath.split("/").filter(Boolean);
    if (!pathParts.length) continue;
    let cursor = root;
    let cursorPath = "";
    for (let index = 0; index < pathParts.length; index += 1) {
      const name = pathParts[index];
      const isFile = index === pathParts.length - 1;
      cursorPath = cursorPath ? `${cursorPath}/${name}` : name;
      if (!isFile) {
        directoryPaths.add(cursorPath);
        let directory = cursor.children.find((child) => child.kind === "directory" && child.name === name);
        if (!directory) {
          directory = { name, kind: "directory", path: cursorPath, children: [] };
          cursor.children.push(directory);
        }
        cursor = directory;
        continue;
      }
      const ext = path.extname(name).toLowerCase();
      const size = object.sizeBytes || 0;
      const isText = Boolean(object.hasPayload && previewExtensions.has(ext) && size <= maxPreviewBytes);
      const isEmbeddable = Boolean(object.hasPayload && embeddableExtensions.has(ext) && size <= maxRawBytes);
      cursor.children.push({
        name,
        kind: "file",
        path: cursorPath,
        size,
        previewable: isText || isEmbeddable,
        previewKind: isText ? "text" : isEmbeddable ? (ext === ".pdf" ? "pdf" : "image") : null,
      });
      fileCount += 1;
    }
  }

  sortTree(root);
  return {
    root,
    fileCount,
    directoryCount: directoryPaths.size,
  };
}

function sortTree(node) {
  if (!Array.isArray(node.children)) return;
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortTree(child);
}

function buildWorkspaceSql({ tenantId, matter }) {
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with target_matter as (",
    "  select",
    "    id, name, client_name, opposite_party, matter_type, jurisdiction, brief_description",
    "  from matters",
    "  where tenant_id = current_app_tenant_id()",
    `    and id = ${sqlUuid(matter.id)}`,
    "), object_rows as (",
    "  select",
    "    so.object_key,",
    "    so.object_role,",
    "    so.mime_type,",
    "    coalesce(sop.size_bytes, so.size_bytes, 0)::bigint as size_bytes,",
    "    (sop.id is not null) as has_payload",
    "  from storage_objects so",
    "  join storage_object_payloads sop on sop.storage_object_id = so.id and sop.tenant_id = so.tenant_id",
    "  where so.tenant_id = current_app_tenant_id()",
    `    and so.matter_id = ${sqlUuid(matter.id)}`,
    "    and so.state in ('uploaded', 'verified')",
    "    and so.object_key is not null",
    ")",
    "select jsonb_build_object(",
    "  'matter', coalesce((select jsonb_build_object(",
    "    'id', id::text,",
    "    'name', name,",
    "    'matterName', name,",
    "    'clientName', coalesce(client_name, ''),",
    "    'oppositeParty', coalesce(opposite_party, ''),",
    "    'matterType', coalesce(matter_type, ''),",
    "    'jurisdiction', coalesce(jurisdiction, ''),",
    "    'briefDescription', coalesce(brief_description, '')",
    "  ) from target_matter), '{}'::jsonb),",
    "  'objects', coalesce((select jsonb_agg(jsonb_build_object(",
    "    'objectKey', object_key,",
    "    'objectRole', object_role,",
    "    'mimeType', coalesce(mime_type, ''),",
    "    'sizeBytes', size_bytes,",
    "    'hasPayload', has_payload",
    "  ) order by object_key) from object_rows), '[]'::jsonb)",
    ")::text;",
    "",
  ].join("\n");
}

function buildPayloadSql({ tenantId, matter, relativePath }) {
  const keys = objectKeyCandidates({ matter, relativePath });
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with candidates as (",
    `  select unnest(${sqlTextArray(keys)}) as object_key`,
    "), payload_rows as (",
    "  select",
    "    so.object_key,",
    "    coalesce(so.mime_type, '') as mime_type,",
    "    coalesce(sop.size_bytes, so.size_bytes, 0)::bigint as size_bytes,",
    "    (sop.id is not null) as has_payload,",
    "    case when sop.id is null then '' else encode(sop.payload, 'base64') end as payload_base64",
    "  from candidates c",
    "  join storage_objects so on so.object_key = c.object_key and so.tenant_id = current_app_tenant_id()",
    "  left join storage_object_payloads sop on sop.storage_object_id = so.id and sop.tenant_id = so.tenant_id",
    `  where so.matter_id = ${sqlUuid(matter.id)}`,
    "    and so.state in ('uploaded', 'verified')",
    "  order by array_position(" + sqlTextArray(keys) + ", so.object_key)",
    "  limit 1",
    ")",
    "select coalesce((select jsonb_build_object(",
    "  'objectKey', object_key,",
    "  'mimeType', mime_type,",
    "  'sizeBytes', size_bytes,",
    "  'hasPayload', has_payload,",
    "  'payloadBase64', payload_base64",
    ") from payload_rows), '{}'::jsonb)::text;",
    "",
  ].join("\n");
}

function buildAdvisorySnapshotSql({ tenantId, matter }) {
  return [
    `select set_config('app.tenant_id', ${sqlString(tenantId)}, false);`,
    "with latest_snapshot as (",
    "  select",
    "    pas.rendered_summary_json,",
    "    pas.created_at,",
    "    m.name as matter_name",
    "  from preparation_advisory_snapshots pas",
    "  join matters m on m.id = pas.matter_id and m.tenant_id = pas.tenant_id",
    "  where pas.tenant_id = current_app_tenant_id()",
    `    and pas.matter_id = ${sqlUuid(matter.id)}`,
    "  order by pas.created_at desc",
    "  limit 1",
    ")",
    "select coalesce((select jsonb_build_object(",
    "  'schema_version', 'matter-attention/v1',",
    "  'generated_at', created_at,",
    "  'matterName', matter_name,",
    "  'matterRoot', 'postgres:' || matter_name,",
    "  'summary', coalesce(rendered_summary_json->'summary', '{}'::jsonb),",
    "  'items', coalesce(rendered_summary_json->'items', '[]'::jsonb)",
    ") from latest_snapshot), '{}'::jsonb)::text;",
    "",
  ].join("\n");
}

function queryJson({ databaseUrl, tenantId, spawn, sql }) {
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], {
    input: sql,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) {
    throw makeHttpError(`runtime DB storage query failed: ${redactRuntimeDbError(result.error.message)}`, 503);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw makeHttpError(`runtime DB storage query failed: ${redactRuntimeDbError(detail)}`, 503);
  }
  return parsePsqlJson(result.stdout || "");
}

function parsePsqlJson(stdout = "") {
  const text = String(stdout || "").trim();
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (!starts.length) throw makeHttpError("runtime DB storage query returned no JSON.", 503);
  const start = Math.min(...starts);
  const objectEnd = text.lastIndexOf("}");
  const arrayEnd = text.lastIndexOf("]");
  const end = Math.max(objectEnd, arrayEnd);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw makeHttpError("runtime DB storage query returned invalid JSON.", 503);
  }
}

function relativePathFromObjectKey(objectKey, matterName) {
  const key = normalizeObjectKey(objectKey);
  const prefix = `${normalizeObjectKey(matterName)}/`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

function objectKeyCandidates({ matter, relativePath }) {
  const names = [
    matter.name,
    matter.folderName,
    matter.matterName,
  ].map(normalizeObjectKey).filter(Boolean);
  const uniqueNames = [...new Set(names)];
  return uniqueNames.map((name) => `${name}/${relativePath}`);
}

function normalizeMatterRelativePath(value) {
  const raw = String(value || "").replaceAll("\\", "/").trim();
  if (!raw) throw makeHttpError("File path is required", 400);
  if (raw.startsWith("/")) throw makeHttpError("Requested path is outside the matter root", 400);
  const normalized = toPosix(path.posix.normalize(raw)).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw makeHttpError("Requested path is outside the matter root", 400);
  }
  if (isBlockedWorkspacePath(normalized)) {
    throw makeHttpError("Requested path is hidden from workspace preview", 403);
  }
  return normalized;
}

function workspaceFilePaths(root) {
  const rows = [];
  function visit(node) {
    if (!node) return;
    if (node.kind === "file" && node.path) rows.push({ path: node.path, size: node.size || 0 });
    for (const child of node.children || []) visit(child);
  }
  visit(root);
  return rows;
}

function extractedArtifacts(paths = []) {
  const extracted = paths.filter((item) => /(^|\/)_extracted\/[^/]+\.json$/i.test(item.path));
  if (!extracted.length) return [];
  const byDirectory = new Map();
  for (const item of extracted) {
    const directory = item.path.replace(/\/[^/]+$/, "");
    byDirectory.set(directory, (byDirectory.get(directory) || 0) + 1);
  }
  return [...byDirectory.entries()].map(([directory, count]) => `${directory} (${count} record${count === 1 ? "" : "s"})`);
}

function statusStage({ id, slash, label, present, artifacts = [], rerunAdvice = null }) {
  return {
    id,
    slash,
    label,
    present: Boolean(present),
    state: present ? "present" : "not_run",
    artifacts,
    ...(rerunAdvice ? { rerunAdvice } : {}),
  };
}

function prepareStage(slash, statusStageValue, previousStage = null) {
  const definition = stageDefinition(slash);
  const base = {
    id: definition.id,
    slash,
    label: definition.label,
    description: definition.description,
    paidProviderCall: definition.paidProviderCall,
    artifacts: Array.isArray(statusStageValue?.artifacts) ? statusStageValue.artifacts : [],
    rerunAdvice: statusStageValue?.rerunAdvice || null,
  };
  if (statusStageValue?.present) {
    return {
      ...base,
      state: "current",
      action: PREPARATION_STAGE_ACTIONS.SKIP_CURRENT,
      reason: `${definition.label} is available from DB payload custody.`,
    };
  }
  if (previousStage && previousStage.state !== "current") {
    return {
      ...base,
      state: "blocked",
      action: PREPARATION_STAGE_ACTIONS.BLOCKED,
      reason: `Complete ${previousStage.label} before ${definition.label}.`,
    };
  }
  return {
    ...base,
    state: "missing",
    action: definition.paidProviderCall ? PREPARATION_STAGE_ACTIONS.CONFIRM_PAID_RUN : PREPARATION_STAGE_ACTIONS.RUN,
    reason: `${definition.label} is missing from DB payload custody.`,
  };
}

function stageDefinition(slash) {
  const definitions = {
    "/matter-init": {
      id: "matter-init",
      label: "Set up matter",
      description: "Create matter metadata, intake registers, and preserved source folders.",
      paidProviderCall: false,
    },
    "/extract": {
      id: "extract",
      label: "Extract documents",
      description: "Build source-backed extraction records from registered working copies.",
      paidProviderCall: false,
    },
    "/describe_sources": {
      id: "describe-sources",
      label: "Label sources",
      description: "Create lawyer-readable source labels in Source Index.json.",
      paidProviderCall: true,
    },
    "/create_listofdates": {
      id: "create-listofdates",
      label: "Create List of Dates",
      description: "Build a source-backed chronology for lawyer review.",
      paidProviderCall: true,
    },
  };
  return definitions[slash];
}

function currentAdvice(reason) {
  return {
    state: "current",
    reason,
  };
}

function emptyAttention(matter) {
  return {
    schema_version: "matter-attention/v1",
    generated_at: new Date(0).toISOString(),
    matterName: matter.matterName || matter.name,
    matterRoot: `postgres:${matter.name}`,
    summary: { total: 0, blocker: 0, warning: 0, info: 0, state: "clear" },
    items: [],
  };
}

function normalizeObjectKey(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function normalizeObjectRow(row = {}) {
  return {
    objectKey: stringValue(row.objectKey),
    objectRole: stringValue(row.objectRole),
    mimeType: stringValue(row.mimeType),
    sizeBytes: Number(row.sizeBytes) || 0,
    hasPayload: Boolean(row.hasPayload),
  };
}

function normalizeMatter(matter = {}) {
  return {
    id: stringValue(matter.id),
    name: stringValue(matter.name || matter.folderName || matter.matterName),
    folderName: stringValue(matter.folderName || matter.name),
    matterName: stringValue(matter.matterName || matter.name),
    clientName: stringValue(matter.clientName),
    oppositeParty: stringValue(matter.oppositeParty),
    matterType: stringValue(matter.matterType),
    jurisdiction: stringValue(matter.jurisdiction),
    briefDescription: stringValue(matter.briefDescription),
  };
}

function sqlUuid(value) {
  return `${sqlString(value)}::uuid`;
}

function sqlTextArray(values = []) {
  if (!values.length) return "ARRAY[]::text[]";
  return `ARRAY[${values.map((value) => sqlString(value)).join(", ")}]::text[]`;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function redactRuntimeDbError(value) {
  return String(value || "")
    .replace(/postgres:\/\/([^:@]+):([^@]+)@/g, "postgres://$1:***@")
    .replace(/\bsecret\b/gi, "***")
    .replace(/\btop-secret\b/gi, "***");
}
