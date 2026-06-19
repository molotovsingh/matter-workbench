import assert from "node:assert/strict";
import test from "node:test";

import {
  createUserReadinessService,
  USER_READINESS_SCHEMA_VERSION,
} from "../services/user-readiness-service.mjs";

const SAFE_TEXT_PATTERN = /openai|openrouter|gpt|llm|api key|quota|billing|credit|model|provider/i;

function serialized(value) {
  return JSON.stringify(value);
}

test("user readiness reports sanitized service labels and messages", async () => {
  const report = await createUserReadinessService({
    aiSettingsService: {
      checkCopilotModel: async () => ({
        ok: true,
        provider: "openrouter",
        model: "openai/gpt-5.4",
        checkedAt: "2026-06-18T12:00:00.000Z",
      }),
      readSettings: () => ({}),
    },
    configService: { getMattersHome: () => "/matters" },
    matterStore: {
      listMattersHomeChildren: async () => [{ name: "A" }, { name: "B" }],
      hasRuntimeDbStorageMode: () => false,
    },
    runtimeDbStorageService: { enabled: false },
    now: () => new Date("2026-06-18T12:00:01.000Z"),
  }).readReadiness();

  assert.equal(report.schema_version, USER_READINESS_SCHEMA_VERSION);
  assert.equal(report.status, "ready");
  assert.equal(report.summary.total, 5);
  assert.equal(report.summary.ready, 5);
  assert.equal(report.checks.at(-1).label, "Assistant readiness");
  assert.equal(report.checks.at(-1).message, "Assistant is ready.");
  assert.doesNotMatch(serialized(report), SAFE_TEXT_PATTERN);
});

test("user readiness collapses assistant backend failures to neutral copy", async () => {
  const report = await createUserReadinessService({
    aiSettingsService: {
      checkCopilotModel: async () => ({
        ok: false,
        provider: "openrouter",
        model: "openai/gpt-5.4",
        error: "quota exceeded",
        checkedAt: "2026-06-18T12:00:00.000Z",
      }),
      readSettings: () => ({}),
    },
    configService: { getMattersHome: () => "/matters" },
    matterStore: {
      listMattersHomeChildren: async () => [],
      hasRuntimeDbStorageMode: () => false,
    },
    runtimeDbStorageService: { enabled: false },
    now: () => new Date("2026-06-18T12:00:01.000Z"),
  }).readReadiness();

  assert.equal(report.status, "degraded");
  const assistant = report.checks.find((check) => check.id === "assistant_readiness");
  assert.equal(assistant.status, "attention");
  assert.equal(assistant.message, "Assistant is temporarily unavailable. You can continue using the workspace.");
  assert.doesNotMatch(serialized(report), SAFE_TEXT_PATTERN);
});

test("user readiness reuses fresh startup assistant check without another live ping", async () => {
  let liveChecks = 0;
  const service = createUserReadinessService({
    aiSettingsService: {
      checkCopilotModel: async () => {
        liveChecks += 1;
        return { ok: true, checkedAt: "2026-06-18T12:00:00.000Z" };
      },
      readSettings: () => ({
        startupChecks: {
          copilot: {
            ok: true,
            provider: "openrouter",
            model: "openai/gpt-5.4",
            checkedAt: "2026-06-18T11:59:00.000Z",
          },
        },
      }),
    },
    configService: { getMattersHome: () => "/matters" },
    matterStore: {
      listMattersHomeChildren: async () => [],
      hasRuntimeDbStorageMode: () => false,
    },
    runtimeDbStorageService: { enabled: false },
    now: () => new Date("2026-06-18T12:00:00.000Z"),
  });

  const report = await service.readReadiness();
  assert.equal(report.status, "ready");
  assert.equal(liveChecks, 0);
  assert.doesNotMatch(serialized(report), SAFE_TEXT_PATTERN);
});
