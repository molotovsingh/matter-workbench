import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePsqlJson,
  queryRuntimeDbJson,
  redactRuntimeDbError,
} from "../services/runtime-db-query.mjs";

test("runtime DB query parses JSON surrounded by psql notices", () => {
  assert.deepEqual(
    parsePsqlJson("NOTICE: role checked\n {\"ok\": true, \"count\": 2}\n"),
    { ok: true, count: 2 },
  );
});

test("runtime DB query exposes caller-specific parse messages", () => {
  assert.throws(
    () => parsePsqlJson("NOTICE: no rows", { noJsonMessage: "storage returned no JSON" }),
    /storage returned no JSON/,
  );
  assert.throws(
    () => parsePsqlJson("{", { invalidJsonMessage: "storage returned bad JSON" }),
    /storage returned bad JSON/,
  );
});

test("runtime DB query applies psql options, safe-role SQL, and maxBuffer", () => {
  const calls = [];
  const result = queryRuntimeDbJson({
    databaseUrl: "postgres://mwb_user:pw%21@db.example:5432/matter_workbench_shadow",
    sql: "select '{\"ok\":true}'::jsonb::text;",
    maxBuffer: 4096,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: "{\"ok\":true}" };
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].command, /psql$/);
  assert.deepEqual(calls[0].args.slice(-4), ["-v", "ON_ERROR_STOP=1", "-t", "-A"]);
  assert.equal(calls[0].options.maxBuffer, 4096);
  assert.equal(calls[0].options.env.PGPASSWORD, "pw!");
  assert.match(calls[0].options.input, /select '\{"ok":true\}'::jsonb::text;/);
});

test("runtime DB query redacts database passwords and provider keys from errors", () => {
  assert.equal(
    redactRuntimeDbError("failed postgres://mwb_user:db-pass@db.example/matter with sk-secret and top-secret"),
    "failed postgres://mwb_user:***@db.example/matter with [redacted-secret] and [redacted-secret]",
  );

  assert.throws(
    () => queryRuntimeDbJson({
      databaseUrl: "postgres://mwb_user:pw@db.example/matter",
      errorPrefix: "runtime DB storage query failed",
      sql: "select '{}'::jsonb::text;",
      spawn() {
        return {
          status: 1,
          stderr: "could not connect postgres://mwb_user:pw@db.example/matter using sk-provider",
        };
      },
    }),
    /runtime DB storage query failed: could not connect postgres:\/\/mwb_user:\*\*\*@db\.example\/matter using \[redacted-secret\]/,
  );
});
