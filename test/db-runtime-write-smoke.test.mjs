import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  renderRuntimeDbWriteSmokeReport,
  runRuntimeDbWriteSmoke,
} from "../scripts/db-runtime-write-smoke.mjs";

test("runtime DB write smoke uploads, verifies DB rows, proves rollback, and deletes cleanup matter", async () => {
  const sqlCalls = [];
  const fetchCalls = [];
  let deleted = false;
  const app = {
    server: {
      listen(_port, _host, callback) {
        callback();
      },
      address() {
        return { port: 12345 };
      },
      close(callback) {
        callback();
      },
    },
  };
  const report = await runRuntimeDbWriteSmoke({
    env: {
      MWB_RUNTIME_DATABASE_URL: "postgres://runtime:runtime-secret@db.example/mwb",
      MWB_DATABASE_URL: "postgres://admin:admin-secret@db.example/mwb",
      MWB_RUNTIME_DB_TENANT_ID: "11111111-1111-4111-8111-111111111111",
    },
    now: () => new Date("2026-06-06T10:00:00.000Z"),
    createServer: async (options) => {
      assert.equal(options.env.MWB_RUNTIME_DB, "postgres");
      assert.equal(options.env.MWB_RUNTIME_DB_STORAGE, "postgres");
      assert.equal(options.env.MWB_DB_RUNTIME_CUTOVER_APPROVED, "yes");
      assert.match(options.env.MWB_RUNTIME_DATABASE_URL, /^postgres:\/\/runtime:/);
      return app;
    },
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({ url: String(url), method: options.method || "GET", body: options.body });
      const pathName = new URL(String(url)).pathname;
      if (pathName === "/api/matters/new") {
        assert.equal(options.method, "POST");
        assert.equal(typeof options.body?.get, "function");
        const submittedName = String(options.body.get("name"));
        return jsonResponse(200, { folderName: submittedName, inputLabel: `postgres:${submittedName}` });
      }
      if (pathName === "/api/switch-matter") {
        return jsonResponse(200, { metadata: { matterName: "Runtime DB Write Smoke -00-000Z" }, tree: [] });
      }
      if (pathName === "/api/file") {
        return jsonResponse(200, { content: "runtime DB write smoke source text\n" });
      }
      if (pathName === "/api/file-raw") {
        return textResponse(200, "runtime DB write smoke source text\n");
      }
      return jsonResponse(404, { error: pathName });
    },
    execSql: async ({ databaseUrl, sql }) => {
      sqlCalls.push({ databaseUrl, sql });
      assert.match(databaseUrl, /^postgres:\/\/runtime:/);
      assert.match(sql, /pg_roles/);
      if (/rolsuper/.test(sql) && /rolbypassrls/.test(sql) && /from pg_roles r/.test(sql)) {
        return { currentUser: "runtime", superuser: false, bypassRls: false };
      }
      if (/select 1 \/ 0/.test(sql)) throw new Error("division by zero");
      if (/rollbackProbeRows/.test(sql)) return { rollbackProbeRows: 0 };
      if (/delete from matters/.test(sql)) {
        deleted = true;
        return {};
      }
      if (/matterCount/.test(sql)) {
        return {
          matterCount: deleted ? 0 : 1,
          activeMatterCount: deleted ? 0 : 1,
          documents: 1,
          storageObjects: 2,
          payloadRows: 2,
          payloadBytes: 512,
          importBatches: 1,
        };
      }
      return {};
    },
  });

  assert.equal(report.passed, true);
  assert.equal(report.databaseUrlSource, "MWB_RUNTIME_DATABASE_URL");
  assert.equal(report.roleGuardPassed, true);
  assert.equal(report.uploadCreated, true);
  assert.equal(report.dbRowsVerified, true);
  assert.equal(report.rollbackVerified, true);
  assert.equal(report.cleanupDeleted, true);
  assert.equal(sqlCalls.some((call) => /begin;\ndo \$mwb_runtime_role_guard\$/.test(call.sql)), true);
  assert.equal(sqlCalls.some((call) => /delete from matters/i.test(call.sql)), true);
  assert.equal(fetchCalls.some((call) => call.url.includes("/api/matters/new")), true);
});

test("runtime DB write smoke fails closed for unsafe runtime roles", async () => {
  const report = await runRuntimeDbWriteSmoke({
    env: {
      MWB_RUNTIME_DATABASE_URL: "postgres://superuser:secret@db.example/mwb",
    },
    execSql: async () => {
      throw new Error("Matter Workbench runtime DB role must not be superuser or BYPASSRLS");
    },
  });

  assert.equal(report.passed, false);
  assert.equal(report.roleGuardPassed, false);
  assert.match(report.error, /must not be superuser/);
  assert.doesNotMatch(report.error, /secret/);
});

test("runtime DB write smoke renderer and docs stay redacted and exposed", async () => {
  const rendered = renderRuntimeDbWriteSmokeReport({
    passed: false,
    databaseUrlSource: "MWB_RUNTIME_DATABASE_URL",
    tenantId: "tenant-id",
    testRunId: "smoke-id",
    matterName: "Runtime DB Write Smoke",
    counts: { matterCount: 1 },
    error: "postgres://runtime:secret@db.example/mwb failed",
  }).join("\n");
  assert.match(rendered, /database_url_source: MWB_RUNTIME_DATABASE_URL/);
  assert.doesNotMatch(rendered, /secret/);
  assert.match(rendered, /\*\*\*/);

  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["db:runtime:write-smoke"], "node scripts/db-runtime-write-smoke.mjs");
});

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function textResponse(status, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return text;
    },
  };
}
