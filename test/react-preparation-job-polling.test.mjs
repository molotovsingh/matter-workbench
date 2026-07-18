import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const pollingPath = new URL("../react-ui/src/lib/preparationJobPolling.ts", import.meta.url);

async function importPollingModule() {
  const source = await readFile(pollingPath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

function job(overrides = {}) {
  return {
    id: "db-old-job",
    backendJobId: "old-job",
    kind: "case_timeline",
    label: "Build Case Timeline",
    status: "failed",
    startedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

test("React preparation polling waits for the requested backend job instead of latching an older failure", async () => {
  const { pollPreparationJob } = await importPollingModule();
  const responses = [
    [job()],
    [job(), job({ id: "db-new-job", backendJobId: "new-job", status: "succeeded" })],
  ];
  let waits = 0;
  const pending = [];

  const result = await pollPreparationJob({
    jobId: "new-job",
    kind: "case_timeline",
    maxPolls: 4,
    maxConsecutiveErrors: 3,
    getJobs: async () => responses.shift() || [],
    wait: async () => { waits += 1; },
    isTransientError: () => false,
    onPending: (candidate) => pending.push(candidate),
  });

  assert.equal(result.state, "succeeded");
  assert.equal(result.job.backendJobId, "new-job");
  assert.equal(waits, 1);
  assert.deepEqual(pending, [null]);
});

test("React preparation polling preserves progress across transient errors and announces recovery", async () => {
  const { pollPreparationJob } = await importPollingModule();
  const networkError = Object.assign(new Error("Failed to fetch"), { code: "api.network_failed" });
  const responses = [networkError, networkError, [job({ status: "succeeded" })]];
  const reconnectCounts = [];
  let recoveries = 0;
  let waits = 0;

  const result = await pollPreparationJob({
    jobId: "old-job",
    kind: "case_timeline",
    maxPolls: 5,
    maxConsecutiveErrors: 3,
    getJobs: async () => {
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response || [];
    },
    wait: async () => { waits += 1; },
    isTransientError: (error) => error?.code === "api.network_failed",
    onTransientError: (_error, count) => reconnectCounts.push(count),
    onRecovery: () => { recoveries += 1; },
  });

  assert.equal(result.state, "succeeded");
  assert.deepEqual(reconnectCounts, [1, 2]);
  assert.equal(recoveries, 1);
  assert.equal(waits, 2);
});

test("React preparation polling stops after its consecutive transient-error bound", async () => {
  const { pollPreparationJob } = await importPollingModule();
  const networkError = Object.assign(new Error("network unavailable"), { code: "api.network_failed" });
  let attempts = 0;
  let waits = 0;

  await assert.rejects(
    () => pollPreparationJob({
      jobId: "new-job",
      kind: "case_timeline",
      maxPolls: 10,
      maxConsecutiveErrors: 2,
      getJobs: async () => { attempts += 1; throw networkError; },
      wait: async () => { waits += 1; },
      isTransientError: (error) => error?.code === "api.network_failed",
    }),
    (error) => error === networkError,
  );

  assert.equal(attempts, 2);
  assert.equal(waits, 1);
});
