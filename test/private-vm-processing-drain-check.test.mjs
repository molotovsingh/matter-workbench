import assert from "node:assert/strict";
import test from "node:test";

import {
  listActiveRuntimeProcessingJobs,
  runPrivateVmProcessingDrainCheck,
} from "../scripts/private-vm-processing-drain-check.mjs";

const runtimeEnv = {
  MWB_RUNTIME_DB: "postgres",
  MWB_RUNTIME_DATABASE_URL: "postgres://runtime:test@127.0.0.1/mwb",
  MWB_RUNTIME_DB_TENANT_ID: "82dc5ad0-fb23-5c08-a06c-73232cd0281f",
};

test("private VM processing drain check skips when runtime DB mode is absent", async () => {
  let created = false;
  const result = await listActiveRuntimeProcessingJobs({
    env: {},
    createClient: () => {
      created = true;
      throw new Error("client should not be created");
    },
  });

  assert.equal(result.enabled, false);
  assert.deepEqual(result.jobs, []);
  assert.equal(created, false);
});

test("private VM processing drain check reads all active queue statuses under tenant RLS", async () => {
  const queries = [];
  const result = await listActiveRuntimeProcessingJobs({
    env: runtimeEnv,
    createClient: (config) => fakeClient({
      config,
      queries,
      rows: [{
        id: "job-1",
        kind: "extract",
        status: "running",
        matter_id: "matter-1",
        attempt_count: 2,
        max_attempts: 3,
        created_at: new Date("2026-08-23T06:15:00.000Z"),
      }],
    }),
  });

  assert.equal(result.enabled, true);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].kind, "extract");
  assert.equal(result.jobs[0].attemptCount, 2);
  assert.match(queries[0].sql, /set_config\('app\.tenant_id'/);
  assert.match(queries[1].sql, /status = any\(\$2::text\[\]\)/);
  assert.deepEqual(queries[1].params[1], ["queued", "running", "retrying"]);
});

test("private VM processing drain check refuses deployment with an active job", async () => {
  const stderr = [];
  const exitCode = await runPrivateVmProcessingDrainCheck({
    env: runtimeEnv,
    createClient: () => fakeClient({
      rows: [{
        id: "job-2",
        kind: "case_timeline",
        status: "retrying",
        matter_id: "matter-2",
        attempt_count: 1,
        max_attempts: 3,
        created_at: "2026-08-23T06:30:00.000Z",
      }],
    }),
    stderr: (line) => stderr.push(line),
  });

  assert.equal(exitCode, 75);
  assert.match(stderr.join("\n"), /Refusing deployment activation/);
  assert.match(stderr.join("\n"), /job-2\tcase_timeline\tretrying/);
  assert.match(stderr.join("\n"), /current release was not restarted/i);
});

test("private VM processing drain check permits a drained queue", async () => {
  const stdout = [];
  const exitCode = await runPrivateVmProcessingDrainCheck({
    env: runtimeEnv,
    createClient: () => fakeClient({ rows: [] }),
    stdout: (line) => stdout.push(line),
  });

  assert.equal(exitCode, 0);
  assert.match(stdout.join("\n"), /queue is drained/i);
});

function fakeClient({ config = {}, queries = [], rows = [] } = {}) {
  return {
    async connect() {
      assert.match(String(config.connectionString || runtimeEnv.MWB_RUNTIME_DATABASE_URL), /^postgres:/);
    },
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      if (/set_config/.test(String(sql))) return { rows: [] };
      return { rows };
    },
    async end() {},
  };
}
