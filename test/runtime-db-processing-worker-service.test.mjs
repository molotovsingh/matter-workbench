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

test("runtime DB processing worker can queue extraction after matter init", async () => {
  const calls = [];
  const matter = { id: "matter-1", name: "Matter A" };
  const job = { id: "job-init", kind: "matter_init", matter, progress: { preparationChainId: "manual-1" } };
  const service = {
    enabled: true,
    async claimNextProcessingJob(options) {
      calls.push(["claim", options.kinds]);
      return calls.filter(([kind]) => kind === "claim").length === 1 ? job : null;
    },
    async initializeMatter(currentMatter, options) {
      calls.push(["initializeMatter", currentMatter.name, options.dryRun]);
      return { operationResult: { state: "succeeded" } };
    },
    async extractDocuments() {
      throw new Error("extract should only be queued, not claimed in this test");
    },
    async completeProcessingJob(jobId, patch) {
      calls.push(["complete", jobId, patch.progress.completedStage]);
    },
    async readPrepareMatterPlan(currentMatter) {
      calls.push(["plan", currentMatter.name]);
      return {
        stages: [
          { id: "matter-init", slash: "/matter-init", action: "skip_current", state: "current" },
          { id: "extract", slash: "/extract", action: "run", state: "missing" },
        ],
      };
    },
    async enqueueProcessingJob({ kind, idempotencyKey, metadata }) {
      calls.push(["enqueue", kind, idempotencyKey, metadata.queuedAfterKind]);
      return { id: "job-extract", kind, status: "queued" };
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

  assert.deepEqual(worker.supportedKinds(), ["matter_init", "extract"]);
  assert.deepEqual(await worker.drainOnce(), { claimed: 1 });
  assert.deepEqual(calls, [
    ["claim", ["matter_init", "extract"]],
    ["initializeMatter", "Matter A", false],
    ["complete", "job-init", "matter_init"],
    ["plan", "Matter A"],
    ["enqueue", "extract", "prepare-chain:matter-1:manual-1:extract", "matter_init"],
    ["claim", ["matter_init", "extract"]],
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

test("runtime DB processing worker queues post-upload preparation stages in dependency order", async () => {
  const calls = [];
  const matter = { id: "matter-1", name: "Matter A" };
  const jobs = [
    { id: "job-extract", kind: "extract", matter, progress: { uploadSessionId: "session-1", preparationChainId: "session-1" } },
  ];
  const nextSlashByCompletedKind = {
    extract: "/describe_sources",
    source_labels: "/create_case_timeline",
    case_timeline: "/the_story",
    matter_story: "/procedural_posture_diagnosis",
  };
  const service = {
    enabled: true,
    async claimNextProcessingJob(options) {
      calls.push(["claim", options.kinds]);
      return jobs.shift() || null;
    },
    async extractDocuments(currentMatter) {
      calls.push(["extract", currentMatter.name]);
      return { operationResult: { state: "succeeded" } };
    },
    async describeSources(currentMatter) {
      calls.push(["describeSources", currentMatter.name]);
      return { operationResult: { state: "succeeded" } };
    },
    async createListOfDates(currentMatter) {
      calls.push(["createListOfDates", currentMatter.name]);
      return { operationResult: { state: "succeeded" } };
    },
    async completeProcessingJob(jobId, patch) {
      calls.push(["complete", jobId, patch.progress.completedStage]);
    },
    async readPrepareMatterPlan(currentMatter) {
      const completedKind = calls.filter(([kind]) => kind === "complete").at(-1)?.[2] || "";
      calls.push(["plan", currentMatter.name, completedKind]);
      const slash = nextSlashByCompletedKind[completedKind];
      return { stages: slash ? [{ slash, action: "confirm_paid_run" }] : [] };
    },
    async enqueueProcessingJob({ matter: queuedMatter, kind, idempotencyKey, metadata }) {
      calls.push(["enqueue", kind, idempotencyKey, metadata.queuedAfterKind, metadata.uploadSessionId]);
      jobs.push({ id: `job-${kind}`, kind, matter: queuedMatter, progress: metadata });
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
      matter_story: async ({ matter: currentMatter }) => {
        calls.push(["matterStory", currentMatter.name]);
        return { state: "succeeded" };
      },
      posture_diagnosis: async ({ matter: currentMatter }) => {
        calls.push(["postureDiagnosis", currentMatter.name]);
        return { state: "succeeded" };
      },
    },
  });

  assert.deepEqual(worker.supportedKinds(), ["extract", "source_labels", "case_timeline", "matter_story", "posture_diagnosis"]);
  assert.deepEqual(await worker.drainOnce(), { claimed: 5 });
  assert.deepEqual(calls, [
    ["claim", ["extract", "source_labels", "case_timeline", "matter_story", "posture_diagnosis"]],
    ["extract", "Matter A"],
    ["complete", "job-extract", "extract"],
    ["plan", "Matter A", "extract"],
    ["enqueue", "source_labels", "prepare-chain:matter-1:session-1:source_labels", "extract", "session-1"],
    ["claim", ["extract", "source_labels", "case_timeline", "matter_story", "posture_diagnosis"]],
    ["describeSources", "Matter A"],
    ["complete", "job-source_labels", "source_labels"],
    ["plan", "Matter A", "source_labels"],
    ["enqueue", "case_timeline", "prepare-chain:matter-1:session-1:case_timeline", "source_labels", "session-1"],
    ["claim", ["extract", "source_labels", "case_timeline", "matter_story", "posture_diagnosis"]],
    ["createListOfDates", "Matter A"],
    ["complete", "job-case_timeline", "case_timeline"],
    ["plan", "Matter A", "case_timeline"],
    ["enqueue", "matter_story", "prepare-chain:matter-1:session-1:matter_story", "case_timeline", "session-1"],
    ["claim", ["extract", "source_labels", "case_timeline", "matter_story", "posture_diagnosis"]],
    ["matterStory", "Matter A"],
    ["complete", "job-matter_story", "matter_story"],
    ["plan", "Matter A", "matter_story"],
    ["enqueue", "posture_diagnosis", "prepare-chain:matter-1:session-1:posture_diagnosis", "matter_story", "session-1"],
    ["claim", ["extract", "source_labels", "case_timeline", "matter_story", "posture_diagnosis"]],
    ["postureDiagnosis", "Matter A"],
    ["complete", "job-posture_diagnosis", "posture_diagnosis"],
    ["plan", "Matter A", "posture_diagnosis"],
    ["claim", ["extract", "source_labels", "case_timeline", "matter_story", "posture_diagnosis"]],
  ]);
});

test("runtime DB processing worker keeps completed jobs succeeded when follow-up queueing fails", async () => {
  const calls = [];
  const service = {
    enabled: true,
    async claimNextProcessingJob(options) {
      calls.push(["claim", options.kinds]);
      return calls.filter(([kind]) => kind === "claim").length === 1
        ? { id: "job-extract", kind: "extract", matter: { id: "matter-1", name: "Matter A" }, progress: { uploadSessionId: "session-1" } }
        : null;
    },
    async extractDocuments() {
      calls.push(["extract"]);
      return { operationResult: { state: "succeeded" } };
    },
    async completeProcessingJob(jobId) {
      calls.push(["complete", jobId]);
    },
    async readPrepareMatterPlan() {
      calls.push(["plan"]);
      throw new Error("plan unavailable");
    },
    async enqueueProcessingJob() {
      calls.push(["enqueue"]);
    },
    async failProcessingJob(jobId, error) {
      calls.push(["fail", jobId, error.message]);
    },
  };
  const warnings = [];
  const worker = createRuntimeDbProcessingWorkerService({
    runtimeDbStorageService: service,
    env: { MWB_RUNTIME_DB_PROCESSING_WORKER: "1" },
    logger: { warn(message) { warnings.push(message); } },
  });

  assert.deepEqual(await worker.drainOnce(), { claimed: 1 });
  assert.deepEqual(calls, [
    ["claim", ["extract"]],
    ["extract"],
    ["complete", "job-extract"],
    ["plan"],
    ["claim", ["extract"]],
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /could not queue follow-up preparation/i);
});

test("runtime DB processing worker can be disabled by env", async () => {
  const worker = createRuntimeDbProcessingWorkerService({
    runtimeDbStorageService: { enabled: true },
    env: { MWB_RUNTIME_DB_PROCESSING_WORKER: "0" },
  });

  assert.equal(worker.enabled(), false);
  assert.equal(worker.start(), false);
});
