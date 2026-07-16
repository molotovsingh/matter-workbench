import {
  CASE_TIMELINE_ARTIFACT_RELATIVE_CANDIDATES,
  SOURCE_INDEX_RELATIVE,
} from "../shared/matter-artifacts.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import { DISPUTE_STORY_OUTPUT_RELATIVE } from "./matter-story-service.mjs";
import { validatedRelativePathFromRuntimeObjectKey } from "./runtime-db-object-key-policy.mjs";

export function createRuntimeDbSourceRemovalPreviewStore({
  withRuntimeDbClient,
  ensureEnabled,
  normalizeMatter,
} = {}) {
  async function readSourceRemovalPreviewState(matter, fileId) {
    ensureEnabled();
    const normalizedMatter = normalizeMatter(matter);
    const normalizedFileId = String(fileId || "").trim().toUpperCase();
    if (!/^FILE-\d{4,}$/.test(normalizedFileId)) {
      throw makeHttpError("A valid FILE-NNNN id is required.", 400, "source_removal_preview.file_id_required");
    }
    return withRuntimeDbClient(async (client) => {
      const identityValues = [normalizedMatter.id || null, normalizedMatter.name || null];
      const sourceResult = await client.query(sourceRecordSql(), [...identityValues, normalizedFileId]);
      const artifactResult = await client.query(artifactInventorySql(), identityValues);
      return normalizePreviewState({
        matter: normalizedMatter,
        sourceRecord: sourceResult.rows?.[0] || null,
        artifactRows: artifactResult.rows || [],
      });
    });
  }

  return { readSourceRemovalPreviewState };
}

export function sourceRecordSql() {
  return [
    "select d.file_id, d.original_name, d.category as document_type, d.status",
    "from documents d",
    "join matters m on m.id = d.matter_id and m.tenant_id = d.tenant_id",
    "where d.tenant_id = current_app_tenant_id()",
    "  and (($1::uuid is not null and m.id = $1::uuid) or ($1::uuid is null and m.name = $2))",
    "  and d.file_id = $3",
    "limit 1",
  ].join("\n");
}

export function artifactInventorySql() {
  return [
    "with target_matter as (",
    "  select id, name from matters",
    "  where tenant_id = current_app_tenant_id()",
    "    and (($1::uuid is not null and id = $1::uuid) or ($1::uuid is null and name = $2))",
    "  limit 1",
    ")",
    "select 'stored'::text as source_kind, so.object_key",
    "from target_matter tm",
    "join storage_objects so on so.tenant_id = current_app_tenant_id() and so.matter_id = tm.id",
    "where so.object_role = 'matter_artifact' and so.state in ('uploaded', 'verified')",
    "union all",
    "select 'custom_skill_output'::text as source_kind, so.object_key",
    "from target_matter tm",
    "join matter_artifacts ma on ma.tenant_id = current_app_tenant_id() and ma.matter_id = tm.id",
    "  and ma.artifact_family = 'custom_skill_output' and ma.is_current = true",
    "join storage_objects so on so.id = ma.storage_object_id and so.tenant_id = ma.tenant_id",
    "where coalesce(so.object_key, '') <> ''",
  ].join("\n");
}

function normalizePreviewState({ matter, sourceRecord, artifactRows }) {
  const storedPaths = new Set(artifactRows
    .filter((row) => row.source_kind === "stored")
    .map((row) => validatedRelativePathFromRuntimeObjectKey(row.object_key, matter.name))
    .filter(Boolean));
  const customSkillOutputPaths = [...new Set(artifactRows
    .filter((row) => row.source_kind === "custom_skill_output")
    .map((row) => validatedRelativePathFromRuntimeObjectKey(row.object_key, matter.name))
    .filter(Boolean))].sort();
  return {
    sourceRecord,
    artifactInventory: {
      sourceIndexPresent: storedPaths.has(SOURCE_INDEX_RELATIVE),
      listOfDatesPresent: CASE_TIMELINE_ARTIFACT_RELATIVE_CANDIDATES.some((relativePath) => storedPaths.has(relativePath)),
      matterStoryPresent: storedPaths.has(DISPUTE_STORY_OUTPUT_RELATIVE),
      customSkillOutputPaths,
    },
  };
}
