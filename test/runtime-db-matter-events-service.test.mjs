import assert from "node:assert/strict";
import test from "node:test";

import {
  appendEventMutationSql,
  appendEventSql,
  createRuntimeDbMatterEventsService,
  listEventsSql,
} from "../services/runtime-db-matter-events-service.mjs";

const tenantId = "82dc5ad0-fb23-5c08-a06c-73232cd0281f";


test("runtime DB matter events service appends idempotent matter_events rows", async () => {
  const calls = [];
  const service = createRuntimeDbMatterEventsService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    idFactory: () => "11111111-1111-4111-8111-111111111111",
    now: () => new Date("2026-06-26T12:00:00.000Z"),
    spawn: jsonSpawn(calls, {
      schema_version: "matter-event/v1",
      eventId: "11111111-1111-4111-8111-111111111111",
      eventType: "custom_skill.created",
      occurredAt: "2026-06-26T12:00:00.000Z",
      createdAt: "2026-06-26T12:00:00.000Z",
      matterId: "22222222-2222-4222-8222-222222222222",
      matterName: "Taori vs Roma Builder",
      actor: { username: "aks", role: "operator" },
      source: { route: "/api/skill-ideas/idea_1/create-skill" },
      summaryKey: "custom_skill_created",
      object: { type: "custom_skill", id: "skill_123", label: "Issue Discovery" },
      payload: { slash: "/issue_discovery", title: "Issue Discovery" },
      idempotencyKey: "custom_skill.created:skill_123:v1",
    }),
  });

  const event = await service.appendEvent({
    eventType: "custom_skill.created",
    matterName: "Taori vs Roma Builder",
    actor: { username: "aks", role: "operator" },
    source: { route: "/api/skill-ideas/idea_1/create-skill" },
    summaryKey: "custom_skill_created",
    object: { type: "custom_skill", id: "skill_123", label: "Issue Discovery" },
    payload: { slash: "/issue_discovery", title: "Issue Discovery" },
    idempotencyKey: "custom_skill.created:skill_123:v1",
  });

  assert.equal(event.eventType, "custom_skill.created");
  assert.equal(event.eventId, "11111111-1111-4111-8111-111111111111");
  const sql = calls[0].input;
  assertTransactionWrapped(sql);
  assert.match(sql, /insert into matter_events/i);
  assert.match(sql, /on conflict \(tenant_id, idempotency_key\) do nothing/i);
  assert.match(sql, /custom_skill\.created/);
  assert.match(sql, /custom_skill_created/);
  assert.match(sql, /Taori vs Roma Builder/);
  assert.doesNotMatch(sql, /secret/);
});

test("runtime DB matter events service lists tenant-scoped event rows", async () => {
  const calls = [];
  const service = createRuntimeDbMatterEventsService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn(calls, [{
      schema_version: "matter-event/v1",
      eventId: "11111111-1111-4111-8111-111111111111",
      eventType: "custom_skill.created",
      occurredAt: "2026-06-26T12:00:00.000Z",
      matterName: "Taori vs Roma Builder",
      summaryKey: "custom_skill_created",
      object: { type: "custom_skill", id: "skill_123" },
      payload: { slash: "/issue_discovery" },
      idempotencyKey: "custom_skill.created:skill_123:v1",
    }]),
  });

  const ledger = await service.listEvents({ matterName: "Taori vs Roma Builder", eventType: "custom_skill.created", limit: 5 });

  assert.equal(ledger.schema_version, "matter-events/v1");
  assert.equal(ledger.events.length, 1);
  assert.equal(ledger.events[0].eventType, "custom_skill.created");
  assertSafeRuntimeRoleGuard(calls[0].input);
  assert.match(calls[0].input, /from matter_events/i);
  assert.match(calls[0].input, /matter_name = 'Taori vs Roma Builder'/);
  assert.match(calls[0].input, /event_type = 'custom_skill.created'/);
  assert.match(calls[0].input, /limit 5/i);
});

test("runtime DB matter event SQL is idempotent and source-delete vocabulary stays blocked", () => {
  const sql = appendEventSql({
    tenantId,
    event: {
      eventId: "11111111-1111-4111-8111-111111111111",
      eventType: "custom_skill.created",
      matterId: "22222222-2222-4222-8222-222222222222",
      summaryKey: "custom_skill_created",
      object: { type: "custom_skill", id: "skill_123" },
      payload: { slash: "/issue_discovery" },
      idempotencyKey: "custom_skill.created:skill_123:v1",
      occurredAt: "2026-06-26T12:00:00.000Z",
    },
  });
  assert.match(sql, /select set_config\('app\.tenant_id'/);
  assert.match(sql, /matter_events/);
  assert.match(sql, /idempotency_key/);
  assert.match(sql, /on conflict \(tenant_id, idempotency_key\) do nothing/i);
  assert.doesNotMatch(sql, /source_file\.deleted/);

  assert.throws(
    () => appendEventSql({ tenantId, event: { eventType: "source_file.deleted", idempotencyKey: "bad" } }),
    (error) => error.statusCode === 400 && error.code === "matter_events.event_type_required",
  );

  const mutationSql = appendEventMutationSql({ event: {
    eventId: "11111111-1111-4111-8111-111111111111",
    eventType: "custom_skill.created",
    matterName: "Matter A",
    summaryKey: "custom_skill_created",
    object: { type: "custom_skill", id: "skill_123" },
    payload: { slash: "/issue_discovery" },
    idempotencyKey: "custom_skill.created:skill_123:v1",
    occurredAt: "2026-06-26T12:00:00.000Z",
  } });
  assert.match(mutationSql, /insert into matter_events/i);
  assert.match(mutationSql, /select 1 from inserted limit 1;/i);
  assert.doesNotMatch(mutationSql, /set_config\('app\.tenant_id'/);
  assert.doesNotMatch(mutationSql, /commit;/i);

  const directMutationSql = appendEventMutationSql({
    eventId: "11111111-1111-4111-8111-111111111111",
    eventType: "custom_skill.created",
    matterName: "Matter A",
    object: { type: "custom_skill", id: "skill_123" },
    idempotencyKey: "custom_skill.created:skill_123:v1",
  });
  assert.match(directMutationSql, /insert into matter_events/i);
  assert.doesNotMatch(directMutationSql, /set_config\('app\.tenant_id'/);

  const listSql = listEventsSql({ tenantId, matterName: "Matter A", eventType: "custom_skill.created", limit: 3 });
  assert.match(listSql, /matter_name = 'Matter A'/);
  assert.match(listSql, /event_type = 'custom_skill.created'/);
  assert.match(listSql, /limit 3/i);
});

test("runtime DB matter events service exposes stable configuration and query codes", async () => {
  const disabled = createRuntimeDbMatterEventsService({});
  await assert.rejects(
    () => disabled.listEvents(),
    (error) => error?.statusCode === 503 && error.code === "runtime_db.matter_events.not_configured",
  );

  const failed = createRuntimeDbMatterEventsService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: () => ({ status: 1, stdout: "", stderr: "ERROR: password=top-secret failure" }),
  });
  await assert.rejects(
    () => failed.listEvents(),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "runtime_db.matter_events.query_failed");
      assert.doesNotMatch(error.message, /top-secret/);
      assert.match(error.message, /\[redacted-secret\]/);
      return true;
    },
  );
});

function jsonSpawn(calls, payload) {
  return (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    return {
      status: 0,
      stdout: `${JSON.stringify(payload)}\n`,
      stderr: "",
    };
  };
}

function assertSafeRuntimeRoleGuard(sql) {
  assert.match(sql, /pg_roles/i);
  assert.match(sql, /rolsuper/i);
  assert.match(sql, /rolbypassrls/i);
  assert.match(sql, /current_user/i);
}

function assertTransactionWrapped(sql) {
  assert.match(sql, /^\s*begin;/i);
  assert.match(sql, /\bcommit;\s*$/i);
  assertSafeRuntimeRoleGuard(sql);
}
