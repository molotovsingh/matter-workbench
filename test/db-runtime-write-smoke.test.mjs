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
      MWB_PRIVATE_BETA_AUTH: "required",
      MWB_PRIVATE_BETA_USERNAME: "operator",
      MWB_PRIVATE_BETA_PASSWORD: "private-secret",
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
      fetchCalls.push({ url: String(url), method: options.method || "GET", body: options.body, headers: options.headers || {} });
      const pathName = new URL(String(url)).pathname;
      if (pathName === "/api/auth/login") {
        assert.equal(options.method, "POST");
        assert.deepEqual(JSON.parse(options.body), { username: "operator", password: "private-secret" });
        return jsonResponse(200, { authenticated: true }, "mwb_private_beta_session=test-session");
      }
      if (pathName === "/api/matters/new") {
        assert.equal(options.method, "POST");
        assert.equal(options.headers?.cookie, "mwb_private_beta_session=test-session");
        assert.equal(typeof options.body?.get, "function");
        const submittedName = String(options.body.get("name"));
        return jsonResponse(200, { folderName: submittedName, inputLabel: `postgres:${submittedName}` });
      }
      if (pathName === "/api/matters/add-files") {
        assert.equal(options.method, "POST");
        assert.equal(options.headers?.cookie, "mwb_private_beta_session=test-session");
        assert.equal(typeof options.body?.get, "function");
        assert.equal(String(options.body.get("matterName")), "Runtime DB Write Smoke -06-06T10-00-00-000Z");
        assert.equal(String(options.body.get("label")), "Follow Up");
        return jsonResponse(200, {
          folderName: String(options.body.get("matterName")),
          inputLabel: `postgres:${String(options.body.get("matterName"))}`,
          intakeAdded: {
            unique: 1,
            intakeDirName: "Intake 02 - 2026-06-06 Follow Up",
          },
        });
      }
      if (pathName === "/api/switch-matter") {
        assert.equal(options.headers?.cookie, "mwb_private_beta_session=test-session");
        return jsonResponse(200, { metadata: { matterName: "Runtime DB Write Smoke -00-000Z" }, tree: [] });
      }
      if (pathName === "/api/file") {
        assert.equal(options.headers?.cookie, "mwb_private_beta_session=test-session");
        if (String(url).includes("follow-up.txt")) {
          return jsonResponse(200, { content: "runtime DB write smoke follow-up text\n" });
        }
        return jsonResponse(200, { content: "runtime DB write smoke source text\n" });
      }
      if (pathName === "/api/file-raw") {
        assert.equal(options.headers?.cookie, "mwb_private_beta_session=test-session");
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
      if (/insert into extraction_records/i.test(sql) && /insert into source_descriptors/i.test(sql) && /superseded_at/i.test(sql)) {
        return {
          targetRows: 1,
          insertedExtractionRows: 1,
          insertedSourceDescriptorRows: 1,
          extractionRows: 1,
          sourceDescriptorRows: 1,
          liveExtractionRows: 0,
          liveSourceDescriptorRows: 0,
        };
      }
      if (/delete from matters/.test(sql)) {
        deleted = true;
        return {};
      }
      if (/matterCount/.test(sql)) {
        return {
          matterCount: deleted ? 0 : 1,
          activeMatterCount: deleted ? 0 : 1,
          documents: 2,
          storageObjects: 3,
          payloadRows: 3,
          payloadBytes: 512,
          importBatches: 2,
        };
      }
      return {};
    },
  });

  assert.equal(report.passed, true);
  assert.equal(report.databaseUrlSource, "MWB_RUNTIME_DATABASE_URL");
  assert.equal(report.roleGuardPassed, true);
  assert.equal(report.uploadCreated, true);
  assert.equal(report.addFilesCreated, true);
  assert.equal(report.followUpPreviewReadable, true);
  assert.equal(report.dbRowsVerified, true);
  assert.equal(report.supersessionVerified, true);
  assert.equal(report.supersessionCounts.insertedExtractionRows, 1);
  assert.equal(report.rollbackVerified, true);
  assert.equal(report.cleanupDeleted, true);
  assert.equal(sqlCalls.some((call) => /begin;\ndo \$mwb_runtime_role_guard\$/.test(call.sql)), true);
  assert.equal(sqlCalls.some((call) => /insert into extraction_records/i.test(call.sql) && /insert into source_descriptors/i.test(call.sql) && /superseded_at/i.test(call.sql)), true);
  assert.equal(sqlCalls.some((call) => /delete from matters/i.test(call.sql)), true);
  assert.equal(fetchCalls.some((call) => call.url.includes("/api/auth/login")), true);
  assert.equal(fetchCalls.some((call) => call.url.includes("/api/matters/new")), true);
  assert.equal(fetchCalls.some((call) => call.url.includes("/api/matters/add-files")), true);
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

function jsonResponse(status, payload, setCookie = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "set-cookie" ? setCookie : "";
      },
    },
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
