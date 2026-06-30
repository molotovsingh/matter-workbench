import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeDbProcessingWorkerService } from "../services/runtime-db-processing-worker-service.mjs";

test("runtime DB processing worker claims and completes extract jobs", async () => {
  const calls = [];
  const job = {
    id: "job-1",
    kind: "extract",
    matter: { id: "matter-1", name: "Matter A" },
  };
  const service = {
    enabled: true,
    async claimNextProcessingJob(options) {
      calls.push(["claim", options.kinds]);
      return calls.filter(([kind]) => kind === "claim").length === 1 ? job : null;
    },
    async extractDocuments(matter, options) {
      calls.push(["extract", matter.name, options.dryRun]);
      return { operationResult: { state: "succeeded" } };
    },
    async completeProcessingJob(jobId, patch) {
      calls.push(["complete", jobId, patch.progress.completedStage]);
    },
    async failProcessingJob(jobId, error) {
      calls.push(["fail", jobId, error.message]);
    },
  };

  const worker = createRuntimeDbProcessingWorkerService({
    runtimeDbStorageService: service,
    env: { MWB_RUNTIME_DB_PROCESSING_WORKER: "1" },
    logger: { warn() {} },
  });

  assert.equal(worker.enabled(), true);
  assert.deepEqual(await worker.drainOnce(), { claimed: 1 });
  assert.deepEqual(calls, [
    ["claim", ["extract"]],
    ["extract", "Matter A", false],
    ["complete", "job-1", "extract"],
    ["claim", ["extract"]],
  ]);
});

test("runtime DB processing worker handles queued source-label and Case Timeline jobs", async () => {
  const calls = [];
  const jobs = [
    { id: "job-source", kind: "source_labels", matter: { id: "matter-1", name: "Matter A" } },
    { id: "job-timeline", kind: "case_timeline", matter: { id: "matter-1", name: "Matter A" } },
  ];
  const service = {
    enabled: true,
    async claimNextProcessingJob(options) {
      calls.push(["claim", options.kinds]);
      return jobs.shift() || null;
    },
    async describeSources(matter, options) {
      calls.push(["describeSources", matter.name, options.dryRun]);
      return { operationResult: { state: "succeeded" } };
    },
    async createListOfDates(matter, options) {
      calls.push(["createListOfDates", matter.name, options.dryRun]);
      return { operationResult: { state: "succeeded" } };
    },
    async completeProcessingJob(jobId, patch) {
      calls.push(["complete", jobId, patch.progress.completedStage]);
    },
    async failProcessingJob(jobId, error) {
      calls.push(["fail", jobId, error.message]);
    },
  };

  const worker = createRuntimeDbProcessingWorkerService({
    runtimeDbStorageService: service,
    env: { MWB_RUNTIME_DB_PROCESSING_WORKER: "1" },
    logger: { warn() {} },
  });

  assert.deepEqual(worker.supportedKinds(), ["source_labels", "case_timeline"]);
  assert.deepEqual(await worker.drainOnce(), { claimed: 2 });
  assert.deepEqual(calls, [
    ["claim", ["source_labels", "case_timeline"]],
    ["describeSources", "Matter A", false],
    ["complete", "job-source", "source_labels"],
    ["claim", ["source_labels", "case_timeline"]],
    ["createListOfDates", "Matter A", false],
    ["complete", "job-timeline", "case_timeline"],
    ["claim", ["source_labels", "case_timeline"]],
  ]);
});

test("runtime DB processing worker can run injected stage handlers", async () => {
  const calls = [];
  const service = {
    enabled: true,
    async claimNextProcessingJob(options) {
      calls.push(["claim", options.kinds]);
      return calls.filter(([kind]) => kind === "claim").length === 1
        ? { id: "job-story", kind: "matter_story", matter: { id: "matter-1", name: "Matter A" } }
        : null;
    },
    async completeProcessingJob(jobId, patch) {
      calls.push(["complete", jobId, patch.progress.completedStage]);
    },
    async failProcessingJob(jobId, error) {
      calls.push(["fail", jobId, error.message]);
    },
  };

  const worker = createRuntimeDbProcessingWorkerService({
    runtimeDbStorageService: service,
    env: { MWB_RUNTIME_DB_PROCESSING_WORKER: "1" },
    logger: { warn() {} },
    stageHandlers: {
      matter_story: async ({ matter }) => {
        calls.push(["matterStory", matter.name]);
        return { state: "succeeded" };
      },
    },
  });

  assert.deepEqual(worker.supportedKinds(), ["matter_story"]);
  assert.deepEqual(await worker.drainOnce(), { claimed: 1 });
  assert.deepEqual(calls, [
    ["claim", ["matter_story"]],
    ["matterStory", "Matter A"],
    ["complete", "job-story", "matter_story"],
    ["claim", ["matter_story"]],
  ]);
});

test("runtime DB processing worker can be disabled by env", async () => {
  const worker = createRuntimeDbProcessingWorkerService({
    runtimeDbStorageService: { enabled: true },
    env: { MWB_RUNTIME_DB_PROCESSING_WORKER: "0" },
  });

  assert.equal(worker.enabled(), false);
  assert.equal(worker.start(), false);
});
