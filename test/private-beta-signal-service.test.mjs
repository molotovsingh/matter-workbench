import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPrivateBetaSignalService } from "../services/private-beta-signal-service.mjs";

test("private beta signal service captures redacted matter attention packets and syncs queued signals", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-beta-signal-"));
  const signalsPath = path.join(tmp, "signals-ledger.json");
  const requests = [];
  const service = createPrivateBetaSignalService({
    signalsPath,
    now: () => new Date("2026-06-07T13:00:00.000Z"),
    idFactory: () => "signal_001",
    syncUrl: "https://mothership.example.test/api/beta-signals",
    syncToken: "secret-sync-token",
    installId: "tester-install-01",
    fetchImpl: async (url, options = {}) => {
      assert.ok(options.signal instanceof AbortSignal);
      requests.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, status: 202, text: async () => "" };
    },
  });

  const result = await service.captureMatterAttention({
    schema_version: "matter-attention/v1",
    matterName: "Atlas Construction vs Diptishree",
    matterRoot: "/Users/aksingh/matters/Atlas Construction vs Diptishree",
    generated_at: "2026-06-07T12:59:00.000Z",
    summary: { state: "attention_needed", blocker: 0, warning: 1, info: 0, total: 1 },
    items: [{
      id: "extraction-ocr-review",
      severity: "warning",
      category: "extraction",
      code: "ocr_review",
      title: "OCR output needs review",
      detail: "Do not send this legal work product body. OPENAI_API_KEY=sk-hidden",
      action: "Compare OCR text against scans.",
      evidence: [
        "00_Inbox/Intake 01/Extraction Log.csv - FILE-0001 - extracted",
        "source text: privileged facts should not cross the wire",
      ],
    }],
  }, { runtimeMode: "postgres" });

  assert.equal(result.captured, 1);
  assert.equal(result.sent, 0);
  assert.equal(result.queued, 1);
  assert.equal(result.signals[0].schema_version, "private-beta-signal/v1");
  assert.equal(result.signals[0].source, "matter_attention");
  assert.equal(result.signals[0].matterName, "Atlas Construction vs Diptishree");
  assert.equal(result.signals[0].summary.blockers, 0);
  assert.equal(result.signals[0].summary.warnings, 1);
  assert.equal(result.signals[0].details.detail, undefined);
  assert.deepEqual(result.signals[0].details.evidence, [
    "00_Inbox/Intake 01/Extraction Log.csv - FILE-0001 - extracted",
  ]);
  assert.equal(result.signals[0].sync.status, "queued");
  assert.equal(existsSync(signalsPath), true);

  assert.equal(requests.length, 0);
  const synced = await service.syncQueuedSignals();
  assert.equal(synced.sent, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://mothership.example.test/api/beta-signals");
  assert.equal(requests[0].options.headers.Authorization, "Bearer secret-sync-token");
  assert.equal(requests[0].body.schema_version, "private-beta-signal-sync/v1");
  assert.equal(requests[0].body.installId, "tester-install-01");
  assert.equal(requests[0].body.signal.source, "matter_attention");
  assert.doesNotMatch(JSON.stringify(requests[0].body), /sk-hidden|legal work product|privileged facts|matterRoot/);

  const store = JSON.parse(await readFile(signalsPath, "utf8"));
  assert.equal(store.schema_version, "private-beta-signal-ledger/v1");
  assert.equal(store.signals.length, 1);
  assert.equal(store.signals[0].sync.status, "sent");
});

test("private beta signal service queues new signals locally without inline mothership sync", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-beta-signal-local-first-"));
  const signalsPath = path.join(tmp, "signals-ledger.json");
  const requests = [];
  const service = createPrivateBetaSignalService({
    signalsPath,
    now: () => new Date("2026-06-12T12:30:00.000Z"),
    idFactory: () => "signal_local_first",
    syncUrl: "https://mothership.example.test/api/beta-signals",
    syncToken: "secret-sync-token",
    installId: "tester-install-01",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 202, text: async () => "" };
    },
  });

  const result = await service.captureMatterAttention({
    matterName: "Taori vs Roma Builder",
    summary: { state: "attention_needed", blocker: 0, warning: 1, info: 0, total: 1 },
    items: [{
      id: "source-labels-warning",
      severity: "warning",
      category: "source_labels",
      code: "needs_review",
      title: "Some source labels need review",
      action: "Confirm labels.",
      evidence: ["10_Library/Source Index.json - FILE-0001 - needs_review"],
    }],
  }, { runtimeMode: "postgres" });

  assert.equal(result.captured, 1);
  assert.equal(result.queued, 1);
  assert.equal(result.sent, 0);
  assert.equal(result.signals[0].sync.status, "queued");
  assert.equal(result.signals[0].sync.attempts, 0);
  assert.equal(requests.length, 0);

  const stored = JSON.parse(await readFile(signalsPath, "utf8"));
  assert.equal(stored.signals[0].id, "signal_local_first");
  assert.equal(stored.signals[0].sync.status, "queued");

  const synced = await service.syncQueuedSignals();
  assert.equal(synced.sent, 1);
  assert.equal(requests.length, 1);
});

test("private beta signal service dedupes repeated monitor signals without inline resend", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-beta-signal-dedupe-"));
  const requestBodies = [];
  const service = createPrivateBetaSignalService({
    signalsPath: path.join(tmp, "signals-ledger.json"),
    now: (() => {
      const dates = [
        new Date("2026-06-07T13:00:00.000Z"),
        new Date("2026-06-07T13:05:00.000Z"),
      ];
      let index = 0;
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    idFactory: () => "signal_repeated",
    syncUrl: "https://mothership.example.test/api/beta-signals",
    fetchImpl: async (_url, options = {}) => {
      requestBodies.push(JSON.parse(options.body));
      return { ok: true, status: 200, text: async () => "" };
    },
  });

  const attention = {
    matterName: "Repeat Matter",
    summary: { state: "attention_needed", blocker: 1, warning: 0, info: 0, total: 1 },
    items: [{ id: "missing-source-index", severity: "blocker", category: "source_labels", code: "missing_source_index", title: "Source Index is missing", action: "Run Source Labels.", evidence: [] }],
  };

  await service.captureMatterAttention(attention);
  const repeated = await service.captureMatterAttention(attention);

  const listed = await service.listSignals();
  assert.equal(requestBodies.length, 0);
  assert.equal(repeated.queued, 1);
  assert.equal(listed.signals.length, 1);
  assert.equal(listed.signals[0].occurrenceCount, 2);
  assert.equal(listed.signals[0].sync.status, "queued");
  assert.equal(listed.signals[0].firstSeenAt, "2026-06-07T13:00:00.000Z");
  assert.equal(listed.signals[0].lastSeenAt, "2026-06-07T13:05:00.000Z");

  const retried = await service.syncQueuedSignals();
  assert.equal(retried.sent, 1);
  assert.equal(requestBodies.length, 1);
  assert.equal(requestBodies[0].signal.occurrenceCount, 2);
});

test("private beta signal service captures failed jobs and skill factory health issues", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-beta-signal-jobs-health-"));
  const service = createPrivateBetaSignalService({
    signalsPath: path.join(tmp, "signals-ledger.json"),
    now: () => new Date("2026-06-07T13:00:00.000Z"),
    idFactory: (() => {
      let index = 0;
      return () => `signal_${++index}`;
    })(),
  });

  const jobs = await service.captureJobSignals({
    schema_version: "job-status-ledger/v1",
    jobs: [{
      id: "job_001",
      kind: "skill-run",
      label: "Run The Story",
      matterName: "Bharat Nagpal Vs Gionee India",
      status: "failed",
      errorMessage: "OPENROUTER_API_KEY=sk-failed while reading draft facts",
      metadata: { sourceText: "do not send", apiKey: "sk-hidden" },
    }, {
      id: "job_002",
      kind: "extract",
      label: "Extract Documents",
      status: "succeeded",
    }],
  });

  assert.equal(jobs.captured, 1);
  assert.equal(jobs.signals[0].source, "job_status");
  assert.equal(jobs.signals[0].details.errorMessage, "OPENROUTER_API_KEY=[redacted-secret] while reading draft facts");
  assert.equal(jobs.signals[0].details.metadata, undefined);

  const health = await service.captureSkillFactoryHealth({
    schema_version: "skill-factory-health/v1",
    state: "warning",
    summary: { errors: 0, warnings: 1, activeSkills: 5 },
    issues: [{
      severity: "warning",
      code: "duplicate_active_slash",
      message: "Custom skill /the_story has a problem. token=sk-skill-secret",
    }],
    storePaths: { skills: "/Users/aksingh/matter-workbench/configurable-skills.json" },
  });

  assert.equal(health.captured, 1);
  assert.equal(health.signals[0].source, "skill_factory_health");
  assert.equal(health.signals[0].details.message, "Custom skill /the_story has a problem. token=[redacted-secret]");
  assert.equal(health.signals[0].details.storePaths, undefined);

  const listed = await service.listSignals();
  assert.equal(listed.schema_version, "private-beta-signal-ledger/v1");
  assert.equal(listed.signals.length, 2);
  assert.doesNotMatch(JSON.stringify(listed), /sk-failed|sk-hidden|sk-skill-secret|do not send|storePaths/);
});

test("private beta signal service queues failed sync and retries later", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-beta-signal-retry-"));
  let fail = true;
  const service = createPrivateBetaSignalService({
    signalsPath: path.join(tmp, "signals-ledger.json"),
    now: (() => {
      const dates = [
        new Date("2026-06-07T13:00:00.000Z"),
        new Date("2026-06-07T13:01:00.000Z"),
      ];
      let index = 0;
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    idFactory: () => "signal_retry",
    syncUrl: "https://mothership.example.test/api/beta-signals",
    fetchImpl: async () => {
      if (fail) throw new Error("network token=sk-signal-secret");
      return { ok: true, status: 200, text: async () => "" };
    },
  });

  const captured = await service.captureMatterAttention({
    matterName: "Queued Matter",
    summary: { blocker: 1, warning: 0, info: 0, total: 1 },
    items: [{ id: "blocked", severity: "blocker", category: "intake", code: "missing_intake", title: "Intake source folder missing", action: "Add source files.", evidence: [] }],
  });

  assert.equal(captured.signals[0].sync.status, "queued");
  assert.equal(captured.signals[0].sync.lastError, undefined);

  const failed = await service.syncQueuedSignals();
  assert.equal(failed.attempted, 1);
  assert.equal(failed.sent, 0);
  assert.equal(failed.queued, 1);
  let listed = await service.listSignals();
  assert.equal(listed.signals[0].sync.status, "queued");
  assert.match(listed.signals[0].sync.lastError, /\[redacted-secret\]/);

  fail = false;
  const retried = await service.syncQueuedSignals();
  assert.equal(retried.schema_version, "private-beta-signal-sync-result/v1");
  assert.equal(retried.attempted, 1);
  assert.equal(retried.sent, 1);
  assert.equal(retried.queued, 0);

  listed = await service.listSignals();
  assert.equal(listed.signals[0].sync.status, "sent");
  assert.equal(listed.signals[0].sync.attempts, 2);
});

test("private beta signal firm-internal mode keeps richer monitor context but still redacts secrets", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-beta-signal-firm-"));
  const requests = [];
  const service = createPrivateBetaSignalService({
    signalsPath: path.join(tmp, "signals-ledger.json"),
    telemetryMode: "firm_internal",
    syncUrl: "https://mothership.example.test/api/beta-signals",
    syncToken: "signal-sync-secret",
    installId: "firm-install-01",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 202, text: async () => "" };
    },
  });

  const attention = await service.captureMatterAttention({
    matterName: "Ayesha Vs Japan Airlines",
    matterRoot: "/Users/aksingh/matters/Ayesha Vs Japan Airlines",
    summary: { state: "attention_needed", blocker: 0, warning: 1, info: 0, total: 1 },
    items: [{
      id: "chronology-warning",
      severity: "warning",
      category: "chronology",
      code: "weak_limitation_story",
      title: "Chronology may miss limitation trigger",
      detail: "The 2023 notice appears in OCR text but not the List of Dates. OPENAI_API_KEY=sk-attention-secret",
      action: "Review the notice and rebuild chronology.",
      evidence: [
        "10_Library/List of Dates.md - missing 2023 notice",
        "source text: Client says notice was sent on 12 March 2023.",
      ],
    }],
  }, { runtimeMode: "postgres" });

  assert.equal(attention.signals[0].telemetryMode, "firm_internal");
  assert.equal(attention.signals[0].details.matterRoot, "/Users/aksingh/matters/Ayesha Vs Japan Airlines");
  assert.match(attention.signals[0].details.detail, /The 2023 notice appears/);
  assert.match(attention.signals[0].details.detail, /OPENAI_API_KEY=\[redacted-secret\]/);
  assert.deepEqual(attention.signals[0].details.evidence, [
    "10_Library/List of Dates.md - missing 2023 notice",
    "source text: Client says notice was sent on 12 March 2023.",
  ]);

  const jobs = await service.captureJobSignals({
    jobs: [{
      id: "job_firm",
      kind: "custom_skill",
      label: "Run The Story",
      matterName: "Ayesha Vs Japan Airlines",
      status: "failed",
      errorMessage: "Failed while reading client facts token=sk-job-secret",
      metadata: {
        sourceText: "Client was denied boarding after producing the itinerary.",
        providerPrompt: "Summarize the facts. OPENROUTER_API_KEY=sk-provider-secret",
      },
    }],
  });

  assert.equal(jobs.signals[0].details.metadata.sourceText, "Client was denied boarding after producing the itinerary.");
  assert.match(jobs.signals[0].details.metadata.providerPrompt, /OPENROUTER_API_KEY=\[redacted-secret\]/);

  const health = await service.captureSkillFactoryHealth({
    state: "warning",
    summary: { errors: 0, warnings: 1, activeSkills: 8 },
    issues: [{ severity: "warning", code: "sample_stale", message: "Sample stale for The Story password=sk-sample-secret" }],
    storePaths: { skills: "/Users/aksingh/matter-workbench/configurable-skills.json" },
  });

  assert.equal(health.signals[0].details.storePaths.skills, "/Users/aksingh/matter-workbench/configurable-skills.json");
  assert.match(health.signals[0].details.message, /password=\[redacted-secret\]/);

  assert.equal(requests.length, 0);
  const synced = await service.syncQueuedSignals();
  assert.equal(synced.sent, 3);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].body.signal.telemetryMode, "firm_internal");
  assert.match(requests[0].body.signal.details.detail, /The 2023 notice appears/);
  assert.equal(requests[0].body.signal.details.evidence[1], "source text: Client says notice was sent on 12 March 2023.");
  assert.doesNotMatch(JSON.stringify(requests), /sk-attention-secret|sk-job-secret|sk-provider-secret|sk-sample-secret|signal-sync-secret/);
});
