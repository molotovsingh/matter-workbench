import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPrivateBetaFeedbackService, formatPrivateBetaFeedbackReport } from "../services/private-beta-feedback-service.mjs";

test("private beta feedback service stores simple tester feedback with safe context", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-feedback-"));
  const feedbackPath = path.join(tmp, "feedback-ledger.json");
  const service = createPrivateBetaFeedbackService({
    feedbackPath,
    now: () => new Date("2026-06-07T10:00:00.000Z"),
    idFactory: () => "feedback_001",
  });

  const record = await service.createFeedback({
    choice: "confused",
    tryingToDo: "Run preparation again",
    happenedInstead: "I saw OPENAI_API_KEY=sk-secret and got lost",
    context: {
      screen: "matter-overview",
      activeMatterName: "Atlas Construction vs Diptishree",
      recentActivity: ["18:00 running: Extract Documents", "OPENROUTER_API_KEY=sk-openrouter-secret"],
      providerPrompt: "Do not store this legal prompt",
      sourceText: "Privileged source text should not be stored",
      generatedOutput: "Draft legal output should not be stored",
      providerRoutes: [{ task: "copilot_answer", provider: "openrouter", model: "openai/gpt-4.1", apiKey: "sk-hidden" }],
    },
  });

  assert.equal(record.schema_version, "private-beta-feedback/v1");
  assert.equal(record.id, "feedback_001");
  assert.equal(record.choice, "confused");
  assert.equal(record.classification, "confusing_ux");
  assert.equal(record.status, "new");
  assert.equal(record.createdAt, "2026-06-07T10:00:00.000Z");
  assert.equal(record.tryingToDo, "Run preparation again");
  assert.match(record.happenedInstead, /\[redacted-secret\]/);
  assert.equal(record.context.screen, "matter-overview");
  assert.equal(record.context.activeMatterName, "Atlas Construction vs Diptishree");
  assert.deepEqual(record.context.recentActivity, [
    "18:00 running: Extract Documents",
    "OPENROUTER_API_KEY=[redacted-secret]",
  ]);
  assert.deepEqual(record.context.providerRoutes, [
    { task: "copilot_answer", provider: "openrouter", model: "openai/gpt-4.1" },
  ]);
  assert.equal(record.context.providerPrompt, undefined);
  assert.equal(record.context.sourceText, undefined);
  assert.equal(record.context.generatedOutput, undefined);
  assert.doesNotMatch(JSON.stringify(record), /sk-secret|sk-openrouter-secret|sk-hidden|Privileged source|Draft legal output/);
  assert.equal(existsSync(feedbackPath), true);

  const listed = await service.listFeedback();
  assert.equal(listed.schema_version, "private-beta-feedback-ledger/v1");
  assert.equal(listed.feedback.length, 1);
  assert.equal(listed.feedback[0].id, "feedback_001");

  const report = formatPrivateBetaFeedbackReport(record);
  assert.match(report, /Private beta feedback/);
  assert.match(report, /Classification: confusing_ux/);
  assert.match(report, /Run preparation again/);
  assert.doesNotMatch(report, /sk-secret|Privileged source|Draft legal output/);

  const store = JSON.parse(await readFile(feedbackPath, "utf8"));
  assert.equal(store.feedback[0].id, "feedback_001");
});

test("private beta feedback service classifies want-something as a net-new feature request", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-feedback-feature-request-"));
  const service = createPrivateBetaFeedbackService({
    feedbackPath: path.join(tmp, "feedback-ledger.json"),
    now: () => new Date("2026-06-13T10:00:00.000Z"),
    idFactory: () => "feedback_feature_request_001",
  });

  const record = await service.createFeedback({
    choice: "want_something",
    tryingToDo: "Ask for a calendar view",
    happenedInstead: "I want a new page that shows filing deadlines by week.",
  });

  assert.equal(record.choice, "want_something");
  assert.equal(record.classification, "feature_request");

  const report = formatPrivateBetaFeedbackReport(record);
  assert.match(report, /Classification: feature_request/);
  assert.doesNotMatch(report, /Classification: bug/);
});

test("private beta feedback firm-internal mode keeps richer context but still redacts secrets", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-feedback-firm-internal-"));
  const requests = [];
  const service = createPrivateBetaFeedbackService({
    feedbackPath: path.join(tmp, "feedback-ledger.json"),
    telemetryMode: "firm_internal",
    syncUrl: "https://mothership.example.test/api/beta-feedback",
    syncToken: "sync-token-secret",
    installId: "firm-install-01",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 202, text: async () => "" };
    },
  });

  const record = await service.createFeedback({
    choice: "did_not_work",
    tryingToDo: "Check the limitation risk in the client file",
    happenedInstead: "The answer missed the 2023 notice. OPENAI_API_KEY=sk-feedback-secret",
    context: {
      screen: "matter-overview",
      activeMatterName: "Bharat Nagpal Vs Gionee India",
      sourceText: "Client says the demand notice was sent on 12 March 2023.",
      generatedOutput: "Draft says limitation starts from 2020.",
      providerPrompt: "Review limitation using the matter packet. token=sk-prompt-secret",
      recentActivity: Array.from({ length: 12 }, (_, index) => `activity line ${index + 1}`),
      providerRoutes: [{ task: "copilot_answer", provider: "openrouter", model: "openai/gpt-4.1", apiKey: "sk-hidden" }],
    },
  });

  assert.equal(record.telemetryMode, "firm_internal");
  assert.equal(record.context.sourceText, "Client says the demand notice was sent on 12 March 2023.");
  assert.equal(record.context.generatedOutput, "Draft says limitation starts from 2020.");
  assert.match(record.context.providerPrompt, /token=\[redacted-secret\]/);
  assert.equal(record.context.recentActivity.length, 12);
  assert.deepEqual(record.context.providerRoutes, [
    { task: "copilot_answer", provider: "openrouter", model: "openai/gpt-4.1" },
  ]);
  assert.equal(record.sync.status, "queued");
  assert.equal(requests.length, 0);
  const synced = await service.syncQueuedFeedback();
  assert.equal(synced.sent, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.feedback.telemetryMode, "firm_internal");
  assert.equal(requests[0].body.feedback.context.sourceText, "Client says the demand notice was sent on 12 March 2023.");
  assert.equal(requests[0].body.feedback.context.generatedOutput, "Draft says limitation starts from 2020.");
  assert.doesNotMatch(JSON.stringify(requests[0].body), /sk-feedback-secret|sk-prompt-secret|sk-hidden|sync-token-secret/);

  const listed = await service.listFeedback();
  assert.equal(listed.feedback[0].context.sourceText, "Client says the demand notice was sent on 12 March 2023.");
});

test("private beta feedback service rejects invalid choices and blank reports", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-feedback-invalid-"));
  const service = createPrivateBetaFeedbackService({
    feedbackPath: path.join(tmp, "feedback-ledger.json"),
  });

  await assert.rejects(
    () => service.createFeedback({ choice: "bug", tryingToDo: "Run preparation" }),
    (error) => error.statusCode === 400
      && error.code === "private_beta.feedback.invalid_choice"
      && /choice must be one of/.test(error.message),
  );
  await assert.rejects(
    () => service.createFeedback({ choice: "did_not_work", tryingToDo: "" }),
    (error) => error.statusCode === 400
      && error.code === "private_beta.feedback.trying_to_do_required"
      && /What were you trying to do/.test(error.message),
  );
});

test("private beta feedback service captures sparse tester problem reports", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-feedback-sparse-"));
  const service = createPrivateBetaFeedbackService({
    feedbackPath: path.join(tmp, "feedback-ledger.json"),
    now: () => new Date("2026-06-12T10:00:00.000Z"),
    idFactory: () => "feedback_sparse_001",
  });

  const record = await service.createFeedback({
    happenedInstead: "The Save button showed a blocked cursor and would not submit.",
    context: { screen: "home" },
  });

  assert.equal(record.id, "feedback_sparse_001");
  assert.equal(record.choice, "did_not_work");
  assert.equal(record.classification, "bug");
  assert.equal(record.tryingToDo, "The Save button showed a blocked cursor and would not submit.");
  assert.equal(record.happenedInstead, "The Save button showed a blocked cursor and would not submit.");
  assert.equal(record.context.screen, "home");

  const listed = await service.listFeedback();
  assert.equal(listed.feedback.length, 1);
  assert.equal(listed.feedback[0].id, "feedback_sparse_001");
});

test("private beta feedback service sends queued safe packets to a configured mothership", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-feedback-sync-"));
  const requests = [];
  const service = createPrivateBetaFeedbackService({
    feedbackPath: path.join(tmp, "feedback-ledger.json"),
    now: () => new Date("2026-06-07T12:00:00.000Z"),
    idFactory: () => "feedback_sync_001",
    syncUrl: "https://mothership.example.test/api/beta-feedback",
    syncToken: "sync-token-secret",
    installId: "tester-install-01",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, status: 202, text: async () => "" };
    },
  });

  const record = await service.createFeedback({
    choice: "did_not_work",
    tryingToDo: "Open Activity",
    happenedInstead: "token=sk-feedback-secret appeared",
    context: {
      screen: "activity",
      sourceText: "Never send source text",
      generatedOutput: "Never send generated output",
      recentActivity: ["OPENAI_API_KEY=sk-hidden"],
    },
  });

  assert.equal(record.sync.status, "queued");
  assert.equal(record.sync.attempts, 0);
  assert.equal(requests.length, 0);
  const synced = await service.syncQueuedFeedback();
  assert.equal(synced.sent, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://mothership.example.test/api/beta-feedback");
  assert.equal(requests[0].options.headers.Authorization, "Bearer sync-token-secret");
  assert.equal(requests[0].body.schema_version, "private-beta-feedback-sync/v1");
  assert.equal(requests[0].body.installId, "tester-install-01");
  assert.equal(requests[0].body.feedback.id, "feedback_sync_001");
  assert.match(requests[0].body.feedback.happenedInstead, /\[redacted-secret\]/);
  assert.doesNotMatch(JSON.stringify(requests[0].body), /sk-feedback-secret|sk-hidden|Never send source text|Never send generated output/);

  const listed = await service.listFeedback();
  assert.equal(listed.feedback[0].sync.status, "sent");
  assert.equal(listed.feedback[0].sync.attempts, 1);
  assert.equal(listed.feedback[0].sync.sentAt, "2026-06-07T12:00:00.000Z");
  assert.equal(listed.feedback[0].sync.endpointHost, "mothership.example.test");
});

test("private beta feedback service queues new feedback locally without inline mothership sync", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-feedback-local-first-"));
  const requests = [];
  const service = createPrivateBetaFeedbackService({
    feedbackPath: path.join(tmp, "feedback-ledger.json"),
    now: () => new Date("2026-06-12T12:00:00.000Z"),
    idFactory: () => "feedback_local_first",
    syncUrl: "https://mothership.example.test/api/beta-feedback",
    syncToken: "sync-token-secret",
    installId: "tester-install-01",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 202, text: async () => "" };
    },
  });

  const record = await service.createFeedback({
    choice: "did_not_work",
    tryingToDo: "Save feedback",
    happenedInstead: "The button showed a blocked cursor.",
  });

  assert.equal(record.sync.status, "queued");
  assert.equal(record.sync.attempts, 0);
  assert.equal(requests.length, 0);

  const stored = JSON.parse(await readFile(path.join(tmp, "feedback-ledger.json"), "utf8"));
  assert.equal(stored.feedback[0].id, "feedback_local_first");
  assert.equal(stored.feedback[0].sync.status, "queued");

  const synced = await service.syncQueuedFeedback();
  assert.equal(synced.sent, 1);
  assert.equal(requests.length, 1);
});

test("private beta feedback service queues failed sync and retries later", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-feedback-sync-retry-"));
  let fail = true;
  const attempts = [];
  const service = createPrivateBetaFeedbackService({
    feedbackPath: path.join(tmp, "feedback-ledger.json"),
    now: (() => {
      const dates = [
        new Date("2026-06-07T12:00:00.000Z"),
        new Date("2026-06-07T12:01:00.000Z"),
      ];
      let index = 0;
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    idFactory: () => "feedback_retry_001",
    syncUrl: "https://mothership.example.test/api/beta-feedback",
    fetchImpl: async (url, options = {}) => {
      attempts.push({ url, body: JSON.parse(options.body) });
      assert.ok(options.signal instanceof AbortSignal);
      if (fail) throw new Error("network token=sk-should-redact");
      return { ok: true, status: 200, text: async () => "" };
    },
  });

  const queued = await service.createFeedback({
    choice: "confused",
    tryingToDo: "Understand the next action",
  });

  assert.equal(queued.sync.status, "queued");
  assert.equal(queued.sync.attempts, 0);
  assert.equal(queued.sync.lastError, undefined);
  assert.equal(attempts.length, 0);

  const failed = await service.syncQueuedFeedback();
  assert.equal(failed.attempted, 1);
  assert.equal(failed.sent, 0);
  assert.equal(failed.queued, 1);
  assert.equal(attempts.length, 1);
  let listed = await service.listFeedback();
  assert.equal(listed.feedback[0].sync.status, "queued");
  assert.match(listed.feedback[0].sync.lastError, /\[redacted-secret\]/);

  fail = false;
  const result = await service.syncQueuedFeedback();
  assert.equal(result.attempted, 1);
  assert.equal(result.sent, 1);
  assert.equal(result.queued, 0);
  assert.equal(attempts.length, 2);

  listed = await service.listFeedback();
  assert.equal(listed.feedback[0].sync.status, "sent");
  assert.equal(listed.feedback[0].sync.attempts, 2);
});

test("private beta feedback service drains multiple queued notes from the explicit sync path", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-feedback-sync-silent-retry-"));
  let nextId = 1;
  const service = createPrivateBetaFeedbackService({
    feedbackPath: path.join(tmp, "feedback-ledger.json"),
    now: (() => {
      const dates = [
        new Date("2026-06-07T12:00:00.000Z"),
        new Date("2026-06-07T12:01:00.000Z"),
        new Date("2026-06-07T12:02:00.000Z"),
      ];
      let index = 0;
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    idFactory: () => `feedback_silent_${nextId++}`,
    syncUrl: "https://mothership.example.test/api/beta-feedback",
    fetchImpl: async () => {
      return { ok: true, status: 200, text: async () => "" };
    },
  });

  const first = await service.createFeedback({
    choice: "confused",
    tryingToDo: "Use the feedback form",
  });
  assert.equal(first.sync.status, "queued");

  const second = await service.createFeedback({
    choice: "want_something",
    tryingToDo: "Ask for an easier feedback button",
  });
  assert.equal(second.sync.status, "queued");

  const synced = await service.syncQueuedFeedback();
  assert.equal(synced.sent, 2);

  const listed = await service.listFeedback();
  const older = listed.feedback.find((item) => item.id === "feedback_silent_1");
  const newer = listed.feedback.find((item) => item.id === "feedback_silent_2");
  assert.equal(older.sync.status, "sent");
  assert.equal(older.sync.attempts, 1);
  assert.equal(newer.sync.status, "sent");
  assert.equal(newer.sync.attempts, 1);
});

test("private beta feedback service ignores malformed historical ledger rows on read", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-feedback-malformed-"));
  const feedbackPath = path.join(tmp, "feedback-ledger.json");
  await writeFile(feedbackPath, JSON.stringify({
    schema_version: "private-beta-feedback-ledger/v1",
    feedback: [
      {
        id: "feedback_good",
        choice: "confused",
        tryingToDo: "Find the Activity page",
        createdAt: "2026-06-07T10:00:00.000Z",
        updatedAt: "2026-06-07T10:00:00.000Z",
      },
      {
        id: "feedback_bad",
        choice: "confused",
        tryingToDo: "",
        createdAt: "2026-06-07T10:01:00.000Z",
        updatedAt: "2026-06-07T10:01:00.000Z",
      },
    ],
  }, null, 2));

  const service = createPrivateBetaFeedbackService({ feedbackPath });

  const listed = await service.listFeedback();

  assert.equal(listed.feedback.length, 1);
  assert.equal(listed.feedback[0].id, "feedback_good");
});

test("private beta feedback service preserves valid legacy feature idea classifications on read", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-feedback-legacy-classification-"));
  const feedbackPath = path.join(tmp, "feedback-ledger.json");
  await writeFile(feedbackPath, JSON.stringify({
    schema_version: "private-beta-feedback-ledger/v1",
    feedback: [
      {
        schema_version: "private-beta-feedback/v1",
        id: "feedback_legacy_feature_idea",
        choice: "want_something",
        classification: "feature_idea",
        status: "new",
        telemetryMode: "safe",
        tryingToDo: "Add a deadline calendar",
        createdAt: "2026-06-07T10:00:00.000Z",
        updatedAt: "2026-06-07T10:00:00.000Z",
      },
    ],
  }, null, 2));

  const service = createPrivateBetaFeedbackService({ feedbackPath });

  const listed = await service.listFeedback();

  assert.equal(listed.feedback.length, 1);
  assert.equal(listed.feedback[0].choice, "want_something");
  assert.equal(listed.feedback[0].classification, "feature_idea");
});
