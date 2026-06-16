import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createSystemHealthService,
  SYSTEM_HEALTH_SCHEMA_VERSION,
} from "../services/system-health-service.mjs";

test("system health reports configuration and provider posture without provider probes", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-system-health-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome);
  await mkdir(path.join(tmp, ".local"));
  await writeFile(path.join(tmp, ".env"), "OPENAI_API_KEY=sk-redacted-test\n", "utf8");

  let providerProbeCalled = false;
  const report = await createSystemHealthService({
    appDir: tmp,
    configService: { getMattersHome: () => mattersHome },
    aiSettingsService: {
      readSettings: () => ({
        aiTasks: [
          { task: "copilot_answer", label: "Matter Copilot", provider: "openrouter", model: "openai/gpt-4.1", ready: true, fallback: "fail_closed" },
          { task: "source_description", label: "Source Labels", provider: "openrouter", model: "openai/gpt-4.1", ready: false, fallback: "fail_closed", note: "OPENROUTER_API_KEY missing" },
        ],
      }),
      testConnection: () => {
        providerProbeCalled = true;
      },
    },
    jobStatusService: { listJobs: async () => ({ jobs: [] }) },
    commandInteractionLogService: { readRecentInteractions: async () => [] },
    matterStore: {
      hasRuntimeDbStorageMode: () => false,
      listMattersHomeChildren: async () => [{ name: "Matter A" }],
    },
    now: () => new Date("2026-06-16T12:00:00.000Z"),
  }).readSystemHealth();

  assert.equal(providerProbeCalled, false);
  assert.equal(report.schema_version, SYSTEM_HEALTH_SCHEMA_VERSION);
  assert.equal(report.status, "warning");
  assert.equal(report.generatedAt, "2026-06-16T12:00:00.000Z");
  assert.equal(report.runtime.storageMode, "filesystem");
  assert.equal(report.checks.find((item) => item.id === "config.matters_home_readable").status, "ok");
  assert.equal(report.checks.find((item) => item.id === "provider.routes_ready").status, "warning");
  assert.match(report.checks.find((item) => item.id === "provider.routes_ready").message, /need setup/i);
  assert.doesNotMatch(JSON.stringify(report), /sk-redacted-test/);
});

test("system health treats missing matters home as a system error outside runtime DB mode", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-system-health-missing-home-"));
  const report = await createSystemHealthService({
    appDir: tmp,
    configService: { getMattersHome: () => "" },
    aiSettingsService: { readSettings: () => ({ aiTasks: [] }) },
    jobStatusService: { listJobs: async () => ({ jobs: [] }) },
    commandInteractionLogService: { readRecentInteractions: async () => [] },
    matterStore: {
      hasRuntimeDbStorageMode: () => false,
      listMattersHomeChildren: async () => [],
    },
  }).readSystemHealth();

  assert.equal(report.status, "error");
  assert.equal(report.summary.blockingIssues, 1);
  assert.match(report.recommendations.join("\n"), /choose a matters folder/i);
});

test("system health reports runtime DB storage mode configuration errors", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-system-health-runtime-storage-"));
  const report = await createSystemHealthService({
    appDir: tmp,
    configService: { getMattersHome: () => "" },
    aiSettingsService: { readSettings: () => ({ aiTasks: [] }) },
    jobStatusService: { listJobs: async () => ({ jobs: [] }) },
    commandInteractionLogService: { readRecentInteractions: async () => [] },
    matterStore: {
      hasRuntimeDbStorageMode: () => true,
      listMattersHomeChildren: async () => [],
    },
    runtimeDbStorageService: { enabled: false },
  }).readSystemHealth();

  const storageModeCheck = report.checks.find((item) => item.id === "storage.workspace_mode");
  assert.equal(storageModeCheck.status, "error");
  assert.equal(report.status, "error");
  assert.match(storageModeCheck.recommendation, /runtime database URL/i);
});

test("system health surfaces global job failures separately from matter attention", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-system-health-jobs-"));
  const report = await createSystemHealthService({
    appDir: tmp,
    configService: { getMattersHome: () => "" },
    aiSettingsService: { readSettings: () => ({ aiTasks: [] }) },
    jobStatusService: {
      listJobs: async () => ({
        jobs: Array.from({ length: 3 }, (_, index) => ({
          id: `job-${index}`,
          kind: "source_labels",
          status: "failed",
          matterName: `Matter ${index}`,
          errorCode: "provider_auth",
          errorMessage: "OpenRouter API key rejected: sk-secret",
        })),
      }),
    },
    commandInteractionLogService: { readRecentInteractions: async () => [] },
    matterStore: {
      hasRuntimeDbStorageMode: () => true,
      listMattersHomeChildren: async () => [],
    },
    runtimeDbStorageService: { enabled: true },
  }).readSystemHealth();

  const jobCheck = report.checks.find((item) => item.id === "runtime.recent_job_failures");
  assert.equal(jobCheck.status, "warning");
  assert.match(jobCheck.recommendation, /provider credentials\/quotas/i);
  assert.doesNotMatch(JSON.stringify(jobCheck), /sk-secret/);
  assert.equal(report.runtime.storageMode, "postgres");
});
