import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SOURCE_REMOVAL_EVENT_TYPE,
  SOURCE_REMOVAL_REPAIR_RELATIVE,
  SOURCE_REMOVAL_STATUS,
  buildRuntimeDbSourceRemovalMutationSql,
  createRuntimeDbSourceRemovalMutationService,
  createSourceRemovalMutationService,
} from "../services/source-removal-mutation-service.mjs";
import {
  ARTIFACT_CURRENTNESS_RELATIVE,
} from "../services/local-artifact-currentness-store.mjs";
import {
  SOURCE_TOMBSTONES_RELATIVE,
} from "../services/active-source-set-service.mjs";

test("local source-removal mutation writes tombstone, event, and currentness without deleting bytes", async () => {
  const root = await makeMatterRoot();
  const events = [];
  const service = createSourceRemovalMutationService({
    matterEventsService: {
      appendEvent: async (event) => {
        events.push(event);
        return event;
      },
    },
    now: () => new Date("2026-06-26T00:00:00.000Z"),
    idFactory: () => "11111111-1111-4111-8111-111111111111",
  });

  const result = await service.removeLocalSourceFromActiveRecord({
    matterRoot: root,
    matterName: "Demo Matter",
    fileId: "FILE-0002",
    reason: "Wrong client file uploaded to this matter.",
    idempotencyKey: "source-removal:demo:FILE-0002:v1",
    previewBuilder: async () => ({
      affected_artifacts: [
        { family: "source_index" },
        { family: "list_of_dates" },
      ],
    }),
  });

  assert.equal(result.schema_version, "source-removal-mutation/v1");
  assert.equal(result.state, SOURCE_REMOVAL_STATUS);
  assert.equal(result.physical_deletion, false);
  assert.equal(result.event_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, SOURCE_REMOVAL_EVENT_TYPE);
  assert.equal(events[0].idempotencyKey, "source-removal:demo:FILE-0002:v1");
  assert.equal(events[0].payload.physical_deletion, false);
  assert.doesNotMatch(JSON.stringify(events[0]), /FILE-0002 text|Fixture chronology|Fixture story/);

  const tombstones = JSON.parse(await readFile(path.join(root, SOURCE_TOMBSTONES_RELATIVE), "utf8"));
  assert.deepEqual(tombstones.sources.map((source) => source.file_id), ["FILE-0002"]);
  assert.equal(tombstones.sources[0].status, SOURCE_REMOVAL_STATUS);
  assert.equal(tombstones.sources[0].event_id, "11111111-1111-4111-8111-111111111111");

  const currentness = JSON.parse(await readFile(path.join(root, ARTIFACT_CURRENTNESS_RELATIVE), "utf8"));
  assert.deepEqual(currentness.records.map((record) => record.artifactFamily), [
    "custom_skill_output",
    "list_of_dates",
    "matter_story",
    "source_index",
  ]);
  assert.equal(
    currentness.records.find((record) => record.artifactFamily === "custom_skill_output").artifactPath,
    "20_Workshop/Issue Notes.md",
  );
  assert.equal(currentness.records.find((record) => record.artifactFamily === "list_of_dates").dependencyState, "chronology_regeneration_needed");
  assert.equal(currentness.records.find((record) => record.artifactFamily === "matter_story").state, "needs_review");
  assert.doesNotMatch(JSON.stringify(currentness), /FILE-0002 text|Fixture chronology|Fixture story/);

  await stat(path.join(root, "00_Inbox", "Intake 01 - Initial", "By Type", "PDFs", "FILE-0002__removed.pdf"));
  await assert.rejects(() => stat(path.join(root, SOURCE_REMOVAL_REPAIR_RELATIVE)), /ENOENT/);
});

test("local source-removal mutation records repair state when event append fails after tombstone", async () => {
  const root = await makeMatterRoot();
  const service = createSourceRemovalMutationService({
    matterEventsService: {
      appendEvent: async () => {
        throw Object.assign(new Error("ledger unavailable"), { code: "test.ledger_unavailable" });
      },
    },
    now: () => new Date("2026-06-26T00:00:00.000Z"),
    idFactory: () => "22222222-2222-4222-8222-222222222222",
  });

  await assert.rejects(
    () => service.removeLocalSourceFromActiveRecord({
      matterRoot: root,
      matterName: "Demo Matter",
      fileId: "FILE-0002",
      reason: "Wrong client file uploaded to this matter.",
      idempotencyKey: "source-removal:demo:FILE-0002:v1",
      previewBuilder: async () => ({ affected_artifacts: [] }),
    }),
    /ledger unavailable/,
  );

  const tombstones = JSON.parse(await readFile(path.join(root, SOURCE_TOMBSTONES_RELATIVE), "utf8"));
  assert.equal(tombstones.sources[0].file_id, "FILE-0002");

  const repair = JSON.parse(await readFile(path.join(root, SOURCE_REMOVAL_REPAIR_RELATIVE), "utf8"));
  assert.equal(repair.schema_version, "source-removal-repair/v1");
  assert.equal(repair.status, "repair_required");
  assert.equal(repair.failed_phase, "matter_event");
  assert.equal(repair.error_code, "test.ledger_unavailable");

  await assert.rejects(
    () => service.removeLocalSourceFromActiveRecord({
      matterRoot: root,
      matterName: "Demo Matter",
      fileId: "FILE-0001",
      reason: "Wrong matter file.",
      idempotencyKey: "source-removal:demo:FILE-0001:v1",
    }),
    (error) => error?.code === "source_removal.repair_required",
  );
});

test("local source-removal mutation resumes the same idempotent request after a partial write", async () => {
  const root = await makeMatterRoot();
  let appendAttempts = 0;
  const service = createSourceRemovalMutationService({
    matterEventsService: {
      appendEvent: async (event) => {
        appendAttempts += 1;
        if (appendAttempts === 1) throw Object.assign(new Error("ledger unavailable"), { code: "test.ledger_unavailable" });
        return event;
      },
    },
    now: () => new Date("2026-06-26T00:00:00.000Z"),
    idFactory: () => "33333333-3333-4333-8333-333333333333",
  });
  const request = {
    matterRoot: root,
    matterName: "Demo Matter",
    fileId: "FILE-0002",
    reason: "Wrong client file uploaded to this matter.",
    idempotencyKey: "source-removal:demo:FILE-0002:resume",
    previewBuilder: async () => ({ affected_artifacts: [] }),
  };

  await assert.rejects(() => service.removeLocalSourceFromActiveRecord(request), /ledger unavailable/);
  const resumed = await service.removeLocalSourceFromActiveRecord(request);

  assert.equal(resumed.state, SOURCE_REMOVAL_STATUS);
  assert.equal(resumed.event_id, "33333333-3333-4333-8333-333333333333");
  assert.equal(appendAttempts, 2);
  await assert.rejects(() => stat(path.join(root, SOURCE_REMOVAL_REPAIR_RELATIVE)), /ENOENT/);
});

test("local source-removal mutation clears a stale pre-mutation repair state with no tombstone", async () => {
  const root = await makeMatterRoot();
  const repairPath = path.join(root, SOURCE_REMOVAL_REPAIR_RELATIVE);
  await mkdir(path.dirname(repairPath), { recursive: true });
  await writeFile(repairPath, JSON.stringify({
    schema_version: "source-removal-repair/v1",
    status: "repair_required",
    phase: "starting",
    file_id: "FILE-0001",
    idempotency_key: "abandoned-before-write",
  }));
  const service = createSourceRemovalMutationService({
    matterEventsService: { appendEvent: async (event) => event },
    idFactory: () => "55555555-5555-4555-8555-555555555555",
  });

  const result = await service.removeLocalSourceFromActiveRecord({
    matterRoot: root,
    matterName: "Demo Matter",
    fileId: "FILE-0002",
    reason: "Wrong client file uploaded to this matter.",
    idempotencyKey: "source-removal:demo:FILE-0002:after-stale-repair",
    previewBuilder: async () => ({ affected_artifacts: [] }),
  });

  assert.equal(result.state, SOURCE_REMOVAL_STATUS);
  await assert.rejects(() => stat(repairPath), /ENOENT/);
});

test("source-removal mutation validates reason and idempotency before writing", async () => {
  const root = await makeMatterRoot();
  const service = createSourceRemovalMutationService({ matterEventsService: { appendEvent: async (event) => event } });

  await assert.rejects(
    () => service.removeLocalSourceFromActiveRecord({ matterRoot: root, fileId: "FILE-0002", reason: "", idempotencyKey: "k" }),
    (error) => error?.code === "source_removal.reason_required",
  );
  await assert.rejects(
    () => service.removeLocalSourceFromActiveRecord({ matterRoot: root, fileId: "FILE-0002", reason: "Wrong file", idempotencyKey: "" }),
    (error) => error?.code === "source_removal.idempotency_key_required",
  );
});

test("runtime DB source-removal SQL locks matter/document, appends event, and avoids deletion", () => {
  const sql = buildRuntimeDbSourceRemovalMutationSql({
    tenantId: "00000000-0000-4000-8000-000000000001",
    matterId: "33333333-3333-4333-8333-333333333333",
    fileId: "FILE-0007",
    reason: "Wrong client file uploaded to this matter.",
    idempotencyKey: "source-removal:runtime:FILE-0007:v1",
    eventId: "44444444-4444-4444-8444-444444444444",
    occurredAt: "2026-06-26T00:00:00.000Z",
  });

  assert.match(sql, /for update/i);
  assert.match(sql, /update documents d/i);
  assert.match(sql, /set status = 'removed_from_active_record'/i);
  assert.match(sql, /insert into matter_events/i);
  assert.match(sql, /join updated_document sd on true/i);
  assert.doesNotMatch(sql, /join selected_document sd on true/i);
  assert.match(sql, /where exists \(select 1 from updated_document\)/i);
  assert.match(sql, /source_file\.removed_from_active_record/);
  assert.match(sql, /on conflict \(tenant_id, idempotency_key\) do nothing/i);
  assert.match(sql, /insert into matter_artifact_currentness/i);
  assert.match(sql, /chronology_regeneration_needed/);
  assert.match(sql, /source_set_review_needed/);
  assert.match(sql, /physical_deletion/);
  assert.doesNotMatch(sql, /delete\s+from/i);
  assert.doesNotMatch(sql, /drop\s+table/i);
});

test("runtime DB source-removal service fails closed when not configured", async () => {
  const service = createRuntimeDbSourceRemovalMutationService({});
  assert.equal(service.enabled, false);
  await assert.rejects(
    () => service.removeRuntimeDbSourceFromActiveRecord({ fileId: "FILE-0001", reason: "Wrong file", idempotencyKey: "k", matterName: "Demo" }),
    (error) => error?.code === "runtime_db.source_removal.not_configured",
  );
});

async function makeMatterRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "source-removal-mutation-"));
  const intake = path.join(root, "00_Inbox", "Intake 01 - Initial");
  await mkdir(path.join(intake, "By Type", "PDFs"), { recursive: true });
  await mkdir(path.join(intake, "_extracted"), { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  await mkdir(path.join(root, "20_Workshop"), { recursive: true });
  await writeFile(path.join(intake, "By Type", "PDFs", "FILE-0001__active.pdf"), "active bytes\n");
  await writeFile(path.join(intake, "By Type", "PDFs", "FILE-0002__removed.pdf"), "removed bytes\n");
  await writeFile(path.join(intake, "File Register.csv"), [
    "file_id,source_path,original_path,working_copy_path,status,sha256,original_name",
    "FILE-0001,00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__active.pdf,00_Inbox/Intake 01 - Initial/Originals/active.pdf,00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__active.pdf,active,hash-1,active.pdf",
    "FILE-0002,00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0002__removed.pdf,00_Inbox/Intake 01 - Initial/Originals/removed.pdf,00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0002__removed.pdf,active,hash-2,removed.pdf",
  ].join("\n") + "\n");
  await writeFile(path.join(intake, "_extracted", "FILE-0002.json"), JSON.stringify({
    schema_version: "extraction-record/v1",
    file_id: "FILE-0002",
    sha256: "hash-2",
    pages: [{ page: 1, blocks: [{ text: "FILE-0002 text" }] }],
  }, null, 2));
  await writeFile(path.join(root, "10_Library", "Source Index.json"), JSON.stringify({
    schema_version: "source-index/v1",
    sources: [{ file_id: "FILE-0002", content_hash: "hash-2" }],
  }, null, 2));
  await writeFile(path.join(root, "10_Library", "Case Timeline.json"), JSON.stringify({
    schema_version: "list-of-dates/v1",
    source_snapshot: [{ file_id: "FILE-0002", content_hash: "hash-2" }],
    entries: [{ event: "Fixture chronology", citation: "FILE-0002 p1.b1" }],
  }, null, 2));
  await writeFile(path.join(root, "10_Library", "Case Timeline.md"), "# Fixture chronology\n");
  await writeFile(path.join(root, "20_Workshop", "The Story.md"), "# Fixture story\n");
  await writeFile(path.join(root, "20_Workshop", "Issue Notes.md"), "# Source-backed issue notes\n");
  await writeFile(path.join(root, "20_Workshop", "Issue Notes.json"), JSON.stringify({
    schema_version: "configurable-skill-run/v1",
    outputPath: "20_Workshop/Issue Notes.md",
    runId: "run_issue_notes",
  }, null, 2));
  return root;
}
