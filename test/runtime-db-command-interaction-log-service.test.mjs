import test from "node:test";
import assert from "node:assert/strict";

import { createRuntimeDbCommandInteractionLogService } from "../services/runtime-db-command-interaction-log-service.mjs";

const tenantId = "82dc5ad0-fb23-5c08-a06c-73232cd0281f";

test("runtime DB command interaction log writes audit events", async () => {
  const calls = [];
  const service = createRuntimeDbCommandInteractionLogService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    idFactory: () => "11111111-1111-4111-8111-111111111111",
    now: () => new Date("2026-06-06T00:00:00.000Z"),
    spawn: jsonSpawn(calls, {}),
  });

  const result = await service.appendInteraction({
    typed_input: "/describe_sources",
    matched_command: "/describe_sources",
    status: "failed",
    matter: { folderName: "DB Matter", matterName: "Legal Caption" },
    errors: ["Provider unavailable"],
  });

  assert.equal(result.logged, true);
  assert.equal(result.path, "postgres:audit_events/command_interaction");
  const sql = calls[0].input;
  assertTransactionWrapped(sql);
  assert.match(sql, /insert into audit_events/i);
  assert.match(sql, /command_interaction/);
  assert.match(sql, /Provider unavailable/);
  assert.match(sql, /DB Matter/);
  assert.doesNotMatch(sql, /secret/);
});

test("runtime DB command interaction log exposes stable query and configuration codes", async () => {
  const disabled = createRuntimeDbCommandInteractionLogService({});
  await assert.rejects(
    () => disabled.readRecentInteractions(),
    (error) => error?.statusCode === 503 && error.code === "runtime_db.command_log.not_configured",
  );

  const noJson = createRuntimeDbCommandInteractionLogService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: () => ({ status: 0, stdout: "NOTICE: no json here\n", stderr: "" }),
  });
  await assert.rejects(
    () => noJson.readRecentInteractions(),
    (error) => error?.statusCode === 503 && error.code === "runtime_db.command_log.no_json",
  );

  const failed = createRuntimeDbCommandInteractionLogService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: () => ({ status: 1, stdout: "", stderr: "ERROR: password=top-secret failure" }),
  });
  await assert.rejects(
    () => failed.readRecentInteractions(),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "runtime_db.command_log.query_failed");
      assert.doesNotMatch(error.message, /top-secret/);
      return true;
    },
  );
});

test("runtime DB command interaction log reads recent audit events", async () => {
  const calls = [];
  const service = createRuntimeDbCommandInteractionLogService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn(calls, [{
      timestamp: "2026-06-06T00:00:00.000Z",
      matter: { folder_name: "DB Matter", matter_name: "Legal Caption" },
      typed_input: "/describe_sources",
      matched_command: "/describe_sources",
      status: "failed",
      errors: ["Provider unavailable"],
    }]),
  });

  const rows = await service.readRecentInteractions({ limit: 5 });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].matched_command, "/describe_sources");
  assert.equal(rows[0].matter.folder_name, "DB Matter");
  assertSafeRuntimeRoleGuard(calls[0].input);
  assert.match(calls[0].input, /from audit_events/i);
  assert.match(calls[0].input, /limit 5/i);
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
