import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildArtifactCurrentnessUpsertCteSql,
  createRuntimeDbArtifactCurrentnessService,
  listArtifactCurrentnessSql,
  upsertArtifactCurrentnessMutationSql,
  upsertArtifactCurrentnessSql,
} from "../services/runtime-db-artifact-currentness-service.mjs";

test("runtime DB artifact currentness upsert SQL is tenant-scoped and idempotent by artifact scope", () => {
  const tenantId = "00000000-0000-4000-8000-000000000001";
  const sql = upsertArtifactCurrentnessSql({
    tenantId,
    record: {
      matterName: "Demo Matter",
      artifactFamily: "list_of_dates",
      artifactPath: "10_Library/Case Timeline.md",
      state: "stale",
      dependencyState: "chronology_regeneration_needed",
      reasonCode: "source_removal.chronology_regeneration_needed",
      affectedFileIds: ["FILE-0007"],
      metadata: { skill: "/create_case_timeline", sourceText: "must not appear" },
      observedAt: "2026-06-26T00:00:00.000Z",
    },
  });

  assert.match(sql, /set_config\('app\.tenant_id', '00000000-0000-4000-8000-000000000001', false\)/);
  assert.match(sql, /insert into matter_artifact_currentness/i);
  assert.match(sql, /from matters/i);
  assert.match(sql, /where tenant_id = current_app_tenant_id\(\)/i);
  assert.match(sql, /and name = 'Demo Matter'/);
  assert.match(sql, /on conflict \(tenant_id, matter_id, artifact_family, artifact_path\) do update/i);
  assert.match(sql, /chronology_regeneration_needed/);
  assert.match(sql, /FILE-0007/);
  assert.doesNotMatch(sql, /must not appear/);
  assert.doesNotMatch(sql, /delete\s+from/i);
});

test("runtime DB artifact currentness mutation SQL can be embedded in a larger transaction", () => {
  const sql = upsertArtifactCurrentnessMutationSql({
    matterId: "22222222-2222-4222-8222-222222222222",
    artifactFamily: "source_index",
    artifactPath: "10_Library/Source Index.json",
    state: "stale",
    dependencyState: "source_set_changed",
    reasonCode: "source_removal.active_source_set_changed",
    affectedFileIds: ["FILE-0002"],
    observedAt: "2026-06-26T00:00:00.000Z",
  });

  assert.doesNotMatch(sql, /set_config\('app\.tenant_id'/);
  assert.match(sql, /and id = '22222222-2222-4222-8222-222222222222'::uuid/);
  assert.match(sql, /select 1 from upserted limit 1/i);
});

test("runtime DB source-removal SQL composes the shared currentness upsert", async () => {
  const cte = buildArtifactCurrentnessUpsertCteSql({
    cteName: "source_removal_currentness",
    includeArtifactId: false,
    sourceSql: "select current_app_tenant_id(), matter_id, artifact_family, artifact_path, state, dependency_state, reason_code, source_event_id, affected_file_ids_json, metadata_json, observed_at, updated_at from candidates",
  });
  assert.match(cte, /^source_removal_currentness as \(/);
  assert.match(cte, /insert into matter_artifact_currentness/i);
  assert.doesNotMatch(cte.split("\n")[1], /artifact_id/);
  assert.doesNotMatch(cte, /artifact_id = excluded\.artifact_id/);

  const removalSource = await readFile(new URL("../services/source-removal-mutation-service.mjs", import.meta.url), "utf8");
  assert.match(removalSource, /buildArtifactCurrentnessUpsertCteSql/);
  assert.doesNotMatch(removalSource, /insert into matter_artifact_currentness/);
});

test("runtime DB artifact currentness list SQL returns normalized records", () => {
  const sql = listArtifactCurrentnessSql({
    tenantId: "00000000-0000-4000-8000-000000000001",
    matterName: "Demo Matter",
    artifactFamily: "matter_story",
    limit: 25,
  });

  assert.match(sql, /from matter_artifact_currentness currentness/i);
  assert.match(sql, /join matters matter/i);
  assert.match(sql, /matter\.name = 'Demo Matter'/);
  assert.match(sql, /currentness\.artifact_family = 'matter_story'/);
  assert.match(sql, /jsonb_agg/);
  assert.match(sql, /affectedFileIds/);
});

test("runtime DB artifact currentness service fails closed when not configured", async () => {
  const service = createRuntimeDbArtifactCurrentnessService({});
  assert.equal(service.enabled, false);
  await assert.rejects(
    () => service.listRecords({ matterName: "Demo Matter" }),
    /Runtime DB artifact currentness is not configured/,
  );
});
