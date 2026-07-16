import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "../shared/atomic-file.mjs";
import { parseCsv } from "../shared/csv.mjs";
import { makeHttpError, toPosix } from "../shared/safe-paths.mjs";
import {
  sqlString,
  sqlUuid,
} from "./runtime-db-sql-format.mjs";
import { wrapRuntimeDbWriteTransaction } from "./runtime-db-sql-safety.mjs";
import { queryRuntimeDbJson } from "./runtime-db-query.mjs";
import {
  SOURCE_TOMBSTONES_RELATIVE,
  SOURCE_TOMBSTONES_SCHEMA_VERSION,
  isInactiveSourceStatus,
  normalizeSourceSuppressionEntry,
} from "./active-source-set-service.mjs";
import { createMatterEventsService } from "./matter-events-service.mjs";
import {
  ARTIFACT_CURRENTNESS_DEPENDENCY_STATES,
  ARTIFACT_CURRENTNESS_FAMILIES,
  ARTIFACT_CURRENTNESS_STATES,
  buildSourceRemovalArtifactCurrentnessEffects,
} from "./artifact-currentness-service.mjs";
import { createLocalArtifactCurrentnessStore } from "./local-artifact-currentness-store.mjs";
import { previewSourceRemovalImpact } from "./source-removal-impact-preview-service.mjs";
import { DISPUTE_STORY_OUTPUT_RELATIVE } from "./matter-story-service.mjs";
import {
  CASE_TIMELINE_ARTIFACT_RELATIVE_CANDIDATES,
  SOURCE_INDEX_RELATIVE,
} from "../shared/matter-artifacts.mjs";

export const SOURCE_REMOVAL_MUTATION_SCHEMA_VERSION = "source-removal-mutation/v1";
export const SOURCE_REMOVAL_EVENT_TYPE = "source_file.removed_from_active_record";
export const SOURCE_REMOVAL_STATUS = "removed_from_active_record";
export const SOURCE_REMOVAL_REPAIR_SCHEMA_VERSION = "source-removal-repair/v1";
export const SOURCE_REMOVAL_REPAIR_RELATIVE = ".matter-workbench/source-removal-repair.json";

const FILE_ID_RE = /^FILE-\d{4,}$/;
const INACTIVE_SOURCE_DOCUMENT_STATUS_SQL = "('removed_from_active_record', 'quarantined', 'deleted_pending', 'deleted')";

export function createSourceRemovalMutationService({
  matterEventsService = null,
  appDir = process.cwd(),
  now = () => new Date(),
  idFactory = () => randomUUID(),
} = {}) {
  let localMutationQueue = Promise.resolve();

  async function removeLocalSourceFromActiveRecord(input = {}) {
    const run = localMutationQueue.then(() => removeLocalSourceFromActiveRecordOnce(input));
    localMutationQueue = run.catch(() => {});
    return run;
  }

  async function removeLocalSourceFromActiveRecordOnce({
    matterRoot = "",
    matterName = "",
    fileId = "",
    reason = "",
    idempotencyKey = "",
    actor = null,
    previewBuilder = previewSourceRemovalImpact,
    currentnessStore = null,
    eventService = matterEventsService,
  } = {}) {
    const request = normalizeRemovalRequest({ matterRoot, matterName, fileId, reason, idempotencyKey });
    const repairPath = path.join(request.matterRoot, SOURCE_REMOVAL_REPAIR_RELATIVE);
    await assertNoBlockingRepairState(repairPath);

    const existingTombstone = await sourceTombstoneForFileId(request.matterRoot, request.fileId);
    const sourceRecord = existingTombstone || await findLocalSourceRecord(request.matterRoot, request.fileId);
    if (!sourceRecord) {
      throw makeHttpError(`${request.fileId} is not present in the matter source register.`, 404, "source_removal.source_not_found");
    }
    if (isInactiveSourceStatus(sourceRecord.status) || existingTombstone) {
      return mutationResult({
        matterName: request.matterName,
        fileId: request.fileId,
        state: "already_inactive",
        source: sanitizeSourceForResult(sourceRecord),
        affectedArtifacts: [],
        warnings: [`${request.fileId} is already inactive.`],
      });
    }

    const occurredAt = isoNow(now);
    const eventId = idFactory();
    const repairBase = {
      schema_version: SOURCE_REMOVAL_REPAIR_SCHEMA_VERSION,
      status: "pending",
      phase: "starting",
      matter_name: request.matterName,
      file_id: request.fileId,
      idempotency_key: request.idempotencyKey,
      event_id: eventId,
      occurred_at: occurredAt,
    };
    await writeRepairState(repairPath, repairBase);

    let preview = null;
    try {
      preview = typeof previewBuilder === "function"
        ? await previewBuilder({ matterRoot: request.matterRoot, fileId: request.fileId })
        : null;
    } catch {
      preview = null;
    }

    const eventPayload = sourceRemovalEventPayload({
      source: sourceRecord,
      request,
      eventId,
      occurredAt,
      actor,
    });
    const currentnessRecords = await buildLocalCurrentnessRecords({
      matterRoot: request.matterRoot,
      matterName: request.matterName,
      fileId: request.fileId,
      preview,
      eventId,
      observedAt: occurredAt,
    });

    try {
      await writeRepairState(repairPath, { ...repairBase, phase: "tombstone_manifest" });
      await upsertLocalSourceTombstone(request.matterRoot, {
        ...sourceRecord,
        file_id: request.fileId,
        status: SOURCE_REMOVAL_STATUS,
        event_id: eventId,
        occurred_at: occurredAt,
        reason: request.reason,
        idempotency_key: request.idempotencyKey,
      });

      await writeRepairState(repairPath, { ...repairBase, phase: "matter_event" });
      const service = eventService || createMatterEventsService({ appDir });
      const event = await service.appendEvent(eventPayload);

      await writeRepairState(repairPath, { ...repairBase, phase: "artifact_currentness" });
      const store = currentnessStore || createLocalArtifactCurrentnessStore({ matterRoot: request.matterRoot, now });
      const currentness = await store.upsertRecords(currentnessRecords);

      await rm(repairPath, { force: true });
      return mutationResult({
        matterName: request.matterName,
        fileId: request.fileId,
        state: SOURCE_REMOVAL_STATUS,
        eventId: event?.eventId || eventId,
        source: sanitizeSourceForResult(sourceRecord),
        affectedArtifacts: currentness.records,
        warnings: [
          "Source bytes, extraction records, descriptors, and generated artifacts were not deleted.",
          "Regeneration remains a separate explicit action.",
        ],
      });
    } catch (error) {
      await writeRepairState(repairPath, {
        ...repairBase,
        status: "repair_required",
        failed_phase: await readRepairPhase(repairPath),
        error_code: error?.code || "source_removal.local_write_failed",
        error_message: safeErrorMessage(error),
      }).catch(() => {});
      throw error;
    }
  }

  return {
    removeLocalSourceFromActiveRecord,
  };
}

export function createRuntimeDbSourceRemovalMutationService({
  databaseUrl = "",
  tenantId = "",
  spawn,
  now = () => new Date(),
  idFactory = () => randomUUID(),
} = {}) {
  const enabled = Boolean(databaseUrl && tenantId);

  async function removeRuntimeDbSourceFromActiveRecord(input = {}) {
    if (!enabled) {
      throw makeHttpError("Runtime DB source removal is not configured", 503, "runtime_db.source_removal.not_configured");
    }
    const request = normalizeRuntimeRemovalRequest(input, { now, idFactory });
    return queryRuntimeDbJson({
      databaseUrl,
      sql: buildRuntimeDbSourceRemovalMutationSql({ tenantId, ...request }),
      spawn,
      errorPrefix: "runtime DB source removal mutation failed",
      errorCode: "runtime_db.source_removal.query_failed",
      noJsonMessage: "runtime DB source removal mutation returned no JSON.",
      noJsonCode: "runtime_db.source_removal.no_json",
      invalidJsonMessage: "runtime DB source removal mutation returned invalid JSON.",
      invalidJsonCode: "runtime_db.source_removal.invalid_json",
    });
  }

  return {
    enabled,
    removeRuntimeDbSourceFromActiveRecord,
  };
}

export function buildRuntimeDbSourceRemovalMutationSql(input = {}) {
  const request = normalizeRuntimeRemovalRequest(input);
  const actorJson = JSON.stringify(normalizeActor(input.actor));
  const sourceJson = JSON.stringify({ route: "source_removal_mutation", method: "INTERNAL" });
  const objectJson = JSON.stringify({ type: "source_file", id: request.fileId, label: request.fileId });
  const payloadJson = JSON.stringify({
    file_id: request.fileId,
    status: SOURCE_REMOVAL_STATUS,
    reason: request.reason,
    physical_deletion: false,
  });
  return wrapRuntimeDbWriteTransaction([
    `select set_config('app.tenant_id', ${sqlString(input.tenantId)}, false);`,
    "with target_matter as (",
    "  select id, name",
    "  from matters",
    "  where tenant_id = current_app_tenant_id()",
    request.matterId ? `    and id = ${sqlUuid(request.matterId)}` : `    and name = ${sqlString(request.matterName)}`,
    "    and status = 'active'",
    "  for update",
    "), target_document as (",
    "  select d.*",
    "  from documents d",
    "  join target_matter tm on tm.id = d.matter_id",
    "  where d.tenant_id = current_app_tenant_id()",
    `    and d.file_id = ${sqlString(request.fileId)}`,
    "  for update",
    "), updated_document as (",
    "  update documents d",
    `  set status = ${sqlString(SOURCE_REMOVAL_STATUS)}, updated_at = ${sqlTimestamp(request.occurredAt)}`,
    "  from target_document td",
    "  where d.tenant_id = current_app_tenant_id()",
    "    and d.id = td.id",
    `    and d.status not in ${INACTIVE_SOURCE_DOCUMENT_STATUS_SQL}`,
    "  returning d.*",
    "), inserted_event as (",
    "  insert into matter_events (id, tenant_id, matter_id, matter_name, event_type, summary_key, actor_json, source_json, object_type, object_id, object_json, payload_json, idempotency_key, occurred_at, created_at)",
    "  select",
    `    ${sqlUuid(request.eventId)},`,
    "    current_app_tenant_id(),",
    "    tm.id,",
    "    tm.name,",
    `    ${sqlString(SOURCE_REMOVAL_EVENT_TYPE)},`,
    "    'source_file_removed_from_active_record',",
    `    ${sqlJson(actorJson)},`,
    `    ${sqlJson(sourceJson)},`,
    "    'source_file',",
    "    sd.file_id,",
    `    ${sqlJson(objectJson)},`,
    `    (${sqlJson(payloadJson)} || jsonb_build_object('previous_status', coalesce(td.status, ''))),`,
    `    ${sqlString(request.idempotencyKey)},`,
    `    ${sqlTimestamp(request.occurredAt)},`,
    `    ${sqlTimestamp(request.occurredAt)}`,
    "  from target_matter tm",
    "  join target_document td on true",
    "  join updated_document sd on true",
    "  on conflict (tenant_id, idempotency_key) do nothing",
    "  returning *",
    "), selected_event as (",
    "  select * from inserted_event",
    "  union all",
    "  select me.* from matter_events me",
    "  where me.tenant_id = current_app_tenant_id()",
    `    and me.idempotency_key = ${sqlString(request.idempotencyKey)}`,
    "    and not exists (select 1 from inserted_event)",
    "  limit 1",
    "), artifact_candidates as (",
    artifactCandidateSql(SOURCE_INDEX_RELATIVE, ARTIFACT_CURRENTNESS_FAMILIES.SOURCE_INDEX, ARTIFACT_CURRENTNESS_STATES.STALE, ARTIFACT_CURRENTNESS_DEPENDENCY_STATES.SOURCE_SET_CHANGED, "source_removal.active_source_set_changed"),
    "  union all",
    artifactCandidateUnionSql(CASE_TIMELINE_ARTIFACT_RELATIVE_CANDIDATES, ARTIFACT_CURRENTNESS_FAMILIES.LIST_OF_DATES, ARTIFACT_CURRENTNESS_STATES.STALE, ARTIFACT_CURRENTNESS_DEPENDENCY_STATES.CHRONOLOGY_REGENERATION_NEEDED, "source_removal.chronology_regeneration_needed"),
    "  union all",
    artifactCandidateSql(DISPUTE_STORY_OUTPUT_RELATIVE, ARTIFACT_CURRENTNESS_FAMILIES.MATTER_STORY, ARTIFACT_CURRENTNESS_STATES.NEEDS_REVIEW, ARTIFACT_CURRENTNESS_DEPENDENCY_STATES.SOURCE_SET_REVIEW_NEEDED, "source_removal.story_needs_review"),
    "  union all",
    "  select",
    "    'custom_skill_output'::text as artifact_family,",
    "    substring(so.object_key from char_length(tm.name) + 2) as artifact_path,",
    "    'needs_review'::text as state,",
    "    'source_set_review_needed'::text as dependency_state,",
    "    'source_removal.custom_skill_output_needs_review'::text as reason_code",
    "  from target_matter tm",
    "  join matter_artifacts ma on ma.tenant_id = current_app_tenant_id() and ma.matter_id = tm.id and ma.artifact_family = 'custom_skill_output' and ma.is_current = true",
    "  left join storage_objects so on so.id = ma.storage_object_id and so.tenant_id = ma.tenant_id",
    "  where exists (select 1 from updated_document)",
    "    and coalesce(so.object_key, '') <> ''",
    "), upserted_currentness as (",
    "  insert into matter_artifact_currentness (tenant_id, matter_id, artifact_family, artifact_path, state, dependency_state, reason_code, source_event_id, affected_file_ids_json, metadata_json, observed_at, updated_at)",
    "  select",
    "    current_app_tenant_id(),",
    "    tm.id,",
    "    ac.artifact_family,",
    "    ac.artifact_path,",
    "    ac.state,",
    "    ac.dependency_state,",
    "    ac.reason_code,",
    "    (select id from selected_event limit 1),",
    `    jsonb_build_array(${sqlString(request.fileId)}),`,
    "    jsonb_build_object('mutation', 'source_removal'),",
    `    ${sqlTimestamp(request.occurredAt)},`,
    `    ${sqlTimestamp(request.occurredAt)}`,
    "  from target_matter tm",
    "  join artifact_candidates ac on true",
    "  where exists (select 1 from updated_document)",
    "  on conflict (tenant_id, matter_id, artifact_family, artifact_path) do update set",
    "    state = excluded.state,",
    "    dependency_state = excluded.dependency_state,",
    "    reason_code = excluded.reason_code,",
    "    source_event_id = excluded.source_event_id,",
    "    affected_file_ids_json = excluded.affected_file_ids_json,",
    "    metadata_json = excluded.metadata_json,",
    "    observed_at = excluded.observed_at,",
    "    updated_at = excluded.updated_at",
    "  returning *",
    ")",
    "select jsonb_build_object(",
    `  'schema_version', ${sqlString(SOURCE_REMOVAL_MUTATION_SCHEMA_VERSION)},`,
    `  'file_id', ${sqlString(request.fileId)},`,
    "  'matter_id', coalesce((select id::text from target_matter limit 1), ''),",
    "  'matter_name', coalesce((select name from target_matter limit 1), ''),",
    "  'state', case",
    "    when not exists (select 1 from target_document) then 'source_not_found'",
    `    when exists (select 1 from target_document where status in ${INACTIVE_SOURCE_DOCUMENT_STATUS_SQL}) then 'already_inactive'`,
    `    else ${sqlString(SOURCE_REMOVAL_STATUS)}`,
    "  end,",
    "  'event_id', coalesce((select id::text from selected_event limit 1), ''),",
    "  'physical_deletion', false,",
    "  'affected_artifacts', coalesce((",
    "    select jsonb_agg(jsonb_build_object(",
    "      'artifactFamily', artifact_family,",
    "      'artifactPath', artifact_path,",
    "      'state', state,",
    "      'dependencyState', dependency_state,",
    "      'reasonCode', reason_code",
    "    ) order by artifact_family, artifact_path)",
    "    from upserted_currentness",
    "  ), '[]'::jsonb)",
    ")::text;",
  ].join("\n"));
}

function artifactCandidateUnionSql(relativePaths, family, state, dependencyState, reasonCode) {
  return relativePaths
    .map((relativePath) => artifactCandidateSql(relativePath, family, state, dependencyState, reasonCode))
    .join("\n  union all\n");
}

function artifactCandidateSql(relativePath, family, state, dependencyState, reasonCode) {
  return [
    "  select",
    `    ${sqlString(family)}::text as artifact_family,`,
    `    ${sqlString(relativePath)}::text as artifact_path,`,
    `    ${sqlString(state)}::text as state,`,
    `    ${sqlString(dependencyState)}::text as dependency_state,`,
    `    ${sqlString(reasonCode)}::text as reason_code`,
    "  from target_matter tm",
    "  where exists (select 1 from updated_document)",
    "    and exists (",
    "      select 1",
    "      from storage_objects so",
    "      where so.tenant_id = current_app_tenant_id()",
    "        and so.matter_id = tm.id",
    "        and so.object_role = 'matter_artifact'",
    "        and so.state in ('uploaded', 'verified')",
    `        and so.object_key = tm.name || '/' || ${sqlString(relativePath)}`,
    "    )",
  ].join("\n");
}

async function buildLocalCurrentnessRecords({ matterRoot, matterName, fileId, preview = null, eventId, observedAt }) {
  const affectedFamilies = new Set((Array.isArray(preview?.affected_artifacts) ? preview.affected_artifacts : [])
    .map((artifact) => artifact.family));
  const sourceIndexPresent = affectedFamilies.has("source_index") || await fileExists(path.join(matterRoot, SOURCE_INDEX_RELATIVE));
  const listOfDatesAffected = affectedFamilies.has("list_of_dates")
    || await anyFileExists(matterRoot, CASE_TIMELINE_ARTIFACT_RELATIVE_CANDIDATES);
  const matterStoryPresent = await fileExists(path.join(matterRoot, DISPUTE_STORY_OUTPUT_RELATIVE));
  return buildSourceRemovalArtifactCurrentnessEffects({
    matterName,
    fileId,
    sourceIndexPresent,
    listOfDatesAffected,
    matterStoryPresent,
    customSkillOutputPaths: [],
    sourceEventId: eventId,
    observedAt,
  });
}

function sourceRemovalEventPayload({ source, request, eventId, occurredAt, actor }) {
  return {
    eventId,
    eventType: SOURCE_REMOVAL_EVENT_TYPE,
    matterName: request.matterName,
    summaryKey: "source_file_removed_from_active_record",
    actor: normalizeActor(actor),
    object: { type: "source_file", id: request.fileId, label: request.fileId },
    payload: {
      file_id: request.fileId,
      status: SOURCE_REMOVAL_STATUS,
      reason: request.reason,
      source_path: normalizePath(source.source_path),
      original_path: normalizePath(source.original_path),
      working_copy_path: normalizePath(source.working_copy_path),
      physical_deletion: false,
    },
    idempotencyKey: request.idempotencyKey,
    occurredAt,
    createdAt: occurredAt,
  };
}

async function findLocalSourceRecord(root, fileId) {
  const intakes = await listIntakeFolders(root);
  for (const intake of intakes) {
    const registerPath = path.join(root, "00_Inbox", intake.name, "File Register.csv");
    let rows = [];
    try {
      rows = parseCsv(await readFile(registerPath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw makeHttpError(`File Register.csv could not be read: ${safeErrorMessage(error)}`, 500, "source_removal.file_register_read_failed");
    }
    const row = rows.find((entry) => normalizeFileId(entry.file_id) === fileId);
    if (row) return { ...row, intake_dir: `00_Inbox/${intake.name}` };
  }
  return null;
}

async function listIntakeFolders(root) {
  try {
    const entries = await readdir(path.join(root, "00_Inbox"), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^Intake (\d{2,})\b/.test(entry.name))
      .map((entry) => ({ name: entry.name, intakeNumber: Number(entry.name.match(/^Intake (\d{2,})/)?.[1] || 0) }))
      .sort((a, b) => a.intakeNumber - b.intakeNumber);
  } catch {
    return [];
  }
}

async function sourceTombstoneForFileId(root, fileId) {
  const manifest = await readTombstoneManifestForWrite(root, { missingOk: true });
  return manifest.sources.find((entry) => normalizeFileId(entry.file_id) === fileId && isInactiveSourceStatus(entry.status)) || null;
}

async function upsertLocalSourceTombstone(root, entry) {
  const manifest = await readTombstoneManifestForWrite(root);
  const normalized = normalizeSourceSuppressionEntry(entry);
  const nextSourcesByFileId = new Map(manifest.sources.map((source) => [normalizeFileId(source.file_id), source]));
  nextSourcesByFileId.set(normalizeFileId(normalized.file_id), {
    ...normalized,
    idempotency_key: normalizeText(entry.idempotency_key || entry.idempotencyKey, 500),
  });
  const next = {
    schema_version: SOURCE_TOMBSTONES_SCHEMA_VERSION,
    sources: [...nextSourcesByFileId.values()].sort((a, b) => String(a.file_id || "").localeCompare(String(b.file_id || ""))),
  };
  const manifestPath = path.join(root, SOURCE_TOMBSTONES_RELATIVE);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFileAtomic(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

async function readTombstoneManifestForWrite(root, { missingOk = false } = {}) {
  const manifestPath = path.join(root, SOURCE_TOMBSTONES_RELATIVE);
  let raw = "";
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { schema_version: SOURCE_TOMBSTONES_SCHEMA_VERSION, sources: [] };
    throw makeHttpError(`Source tombstone manifest could not be read: ${safeErrorMessage(error)}`, 500, "source_removal.tombstone_manifest_read_failed");
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.schema_version !== SOURCE_TOMBSTONES_SCHEMA_VERSION) {
      throw makeHttpError("Source tombstone manifest has an unsupported schema.", 409, "source_removal.tombstone_manifest_invalid");
    }
    return {
      schema_version: SOURCE_TOMBSTONES_SCHEMA_VERSION,
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    };
  } catch (error) {
    if (error?.statusCode) throw error;
    if (missingOk) return { schema_version: SOURCE_TOMBSTONES_SCHEMA_VERSION, sources: [] };
    throw makeHttpError(`Source tombstone manifest is invalid: ${safeErrorMessage(error)}`, 409, "source_removal.tombstone_manifest_invalid");
  }
}

async function assertNoBlockingRepairState(repairPath) {
  let raw = "";
  try {
    raw = await readFile(repairPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw makeHttpError(`Source removal repair state could not be read: ${safeErrorMessage(error)}`, 500, "source_removal.repair_state_read_failed");
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.schema_version === SOURCE_REMOVAL_REPAIR_SCHEMA_VERSION && parsed.status !== "completed") {
      throw makeHttpError("A previous source-removal mutation needs operator repair before another removal can run.", 409, "source_removal.repair_required");
    }
  } catch (error) {
    if (error?.statusCode) throw error;
    throw makeHttpError("A previous source-removal repair state is unreadable and needs operator repair.", 409, "source_removal.repair_required");
  }
}

async function writeRepairState(repairPath, state) {
  await mkdir(path.dirname(repairPath), { recursive: true });
  await writeFileAtomic(repairPath, `${JSON.stringify(state, null, 2)}\n`);
}

async function readRepairPhase(repairPath) {
  try {
    const parsed = JSON.parse(await readFile(repairPath, "utf8"));
    return normalizeText(parsed.phase, 80);
  } catch {
    return "unknown";
  }
}

async function anyFileExists(root, relativePaths = []) {
  for (const relativePath of relativePaths) {
    if (await fileExists(path.join(root, relativePath))) return true;
  }
  return false;
}

async function fileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function normalizeRemovalRequest({ matterRoot = "", matterName = "", fileId = "", reason = "", idempotencyKey = "" } = {}) {
  const normalizedRoot = normalizeText(matterRoot, 2000);
  const normalized = {
    matterRoot: normalizedRoot,
    matterName: normalizeText(matterName, 500) || (normalizedRoot ? path.basename(normalizedRoot) : ""),
    fileId: normalizeFileId(fileId),
    reason: normalizeReason(reason),
    idempotencyKey: normalizeText(idempotencyKey, 500),
  };
  if (!normalized.matterRoot) throw makeHttpError("Matter root is required.", 400, "source_removal.matter_required");
  validateCommonRemovalRequest(normalized);
  return normalized;
}

function normalizeRuntimeRemovalRequest(input = {}, { now = () => new Date(), idFactory = () => randomUUID() } = {}) {
  const request = {
    matterId: normalizeText(input.matterId || input.matter_id, 80),
    matterName: normalizeText(input.matterName || input.matter || input.matter_name, 500),
    fileId: normalizeFileId(input.fileId || input.file_id),
    reason: normalizeReason(input.reason),
    idempotencyKey: normalizeText(input.idempotencyKey || input.idempotency_key, 500),
    eventId: normalizeText(input.eventId || input.event_id, 80) || idFactory(),
    occurredAt: normalizeIso(input.occurredAt || input.occurred_at) || isoNow(now),
  };
  if (!request.matterId && !request.matterName) throw makeHttpError("Matter id or name is required.", 400, "source_removal.matter_required");
  validateCommonRemovalRequest(request);
  return request;
}

function validateCommonRemovalRequest(request) {
  if (!request.fileId) throw makeHttpError("A valid FILE-NNNN id is required.", 400, "source_removal.file_id_required");
  if (!request.reason) throw makeHttpError("A source-removal reason is required.", 400, "source_removal.reason_required");
  if (!request.idempotencyKey) throw makeHttpError("A source-removal idempotency key is required.", 400, "source_removal.idempotency_key_required");
}

function mutationResult({ matterName, fileId, state, eventId = "", source = null, affectedArtifacts = [], warnings = [] } = {}) {
  return removeEmpty({
    schema_version: SOURCE_REMOVAL_MUTATION_SCHEMA_VERSION,
    matterName: normalizeText(matterName, 500),
    file_id: normalizeFileId(fileId),
    state,
    event_id: normalizeText(eventId, 80),
    action_label: "Remove from active record",
    physical_deletion: false,
    source,
    affected_artifacts: affectedArtifacts,
    warnings,
  });
}

function sanitizeSourceForResult(source = {}) {
  return removeEmpty({
    file_id: normalizeFileId(source.file_id),
    source_path: normalizePath(source.source_path),
    original_path: normalizePath(source.original_path),
    working_copy_path: normalizePath(source.working_copy_path),
    status: normalizeText(source.status, 80),
  });
}

function normalizeActor(actor = {}) {
  const raw = actor && typeof actor === "object" ? actor : {};
  return removeEmpty({
    username: normalizeText(raw.username, 120),
    displayName: normalizeText(raw.displayName || raw.display_name, 120),
    role: normalizeText(raw.role, 80),
    type: normalizeText(raw.type || (raw.username ? "user" : "system"), 40),
  });
}

function normalizeReason(value = "") {
  return normalizeText(value, 500);
}

function normalizeFileId(value = "") {
  const text = normalizeText(value, 40).toUpperCase();
  return FILE_ID_RE.test(text) ? text : "";
}

function normalizePath(value = "") {
  return toPosix(normalizeText(value, 1000));
}

function normalizeText(value = "", maxLength = 1000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function normalizeIso(value = "") {
  const text = normalizeText(value, 80);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function isoNow(now = () => new Date()) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function safeErrorMessage(error) {
  return normalizeText(error?.message || String(error || "error"), 300);
}

function sqlTimestamp(value) {
  return `${sqlString(value || new Date().toISOString())}::timestamptz`;
}

function sqlJson(jsonText) {
  return `${sqlString(jsonText)}::jsonb`;
}

function removeEmpty(input = {}) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value) continue;
    if (Array.isArray(value) && !value.length) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = removeEmpty(value);
      if (!Object.keys(nested).length) continue;
      output[key] = nested;
      continue;
    }
    output[key] = value;
  }
  return output;
}
