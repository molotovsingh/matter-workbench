import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { createMothershipStore } from "../mothership/store.mjs";
import { generateIngestionToken, hashIngestionToken } from "../mothership/tokens.mjs";

test("ingestion tokens expose raw value once and persist only a digest", () => {
  const token = generateIngestionToken({
    randomBytesImpl: () => Buffer.from("0123456789abcdef0123456789abcdef", "utf8"),
  });

  assert.match(token.rawToken, /^mwb_ing_/);
  assert.equal(token.tokenSha256, hashIngestionToken(token.rawToken));
  assert.equal(token.tokenPrefix, token.rawToken.slice(0, 16));
  assert.doesNotMatch(token.tokenSha256, /0123456789abcdef/);
});

test("store registers an installation without sending the raw token to PostgreSQL", async () => {
  const calls = [];
  const database = fakeDatabase({
    onQuery(text, values) {
      calls.push({ text, values });
      return { rowCount: 1, rows: [] };
    },
  });
  const store = createMothershipStore({
    database,
    tokenFactory: () => ({
      rawToken: "mwb_ing_raw-secret-value",
      tokenSha256: "a".repeat(64),
      tokenPrefix: "mwb_ing_raw-secr",
    }),
  });

  const result = await store.registerInstallation({ installationId: "firm-beta-01", label: "Firm beta" });

  assert.equal(result.installationId, "firm-beta-01");
  assert.equal(result.rawToken, "mwb_ing_raw-secret-value");
  assert.equal(calls.length, 3);
  assert.match(calls[0].text, /insert into mothership_installations/i);
  assert.match(calls[1].text, /update mothership_ingestion_tokens/i);
  assert.match(calls[1].text, /set status = 'revoked'/i);
  assert.match(calls[2].text, /insert into mothership_ingestion_tokens/i);
  assert.doesNotMatch(JSON.stringify(calls), /raw-secret-value/);
  assert.match(JSON.stringify(calls), new RegExp("a{64}"));
});

test("store authenticates active tokens and rejects installation mismatch or revocation", async () => {
  let status = "active";
  const database = fakeDatabase({
    onQuery(text, values) {
      if (/from mothership_ingestion_tokens/i.test(text)) {
        return {
          rowCount: 1,
          rows: [{ installation_id: "firm-beta-01", installation_status: status, token_status: status }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  });
  const store = createMothershipStore({ database });

  const authenticated = await store.authorizeIngestion({ rawToken: "token-one", installationId: "firm-beta-01" });
  assert.equal(authenticated.installationId, "firm-beta-01");

  await assert.rejects(
    () => store.authorizeIngestion({ rawToken: "token-one", installationId: "another-install" }),
    (error) => error.statusCode === 403 && /does not match/i.test(error.message),
  );

  status = "revoked";
  await assert.rejects(
    () => store.authorizeIngestion({ rawToken: "token-one", installationId: "firm-beta-01" }),
    (error) => error.statusCode === 403 && /revoked/i.test(error.message),
  );
});

test("store inserts feedback and signals idempotently with parameterized payloads", async () => {
  const calls = [];
  let feedbackInsertCount = 0;
  let signalUpsertCount = 0;
  const database = fakeDatabase({
    onQuery(text, values) {
      calls.push({ text, values });
      if (/insert into mothership_feedback_events/i.test(text)) {
        feedbackInsertCount += 1;
        return { rowCount: feedbackInsertCount % 2, rows: feedbackInsertCount % 2 ? [{ id: feedbackInsertCount }] : [] };
      }
      if (/insert into mothership_signal_events/i.test(text)) {
        signalUpsertCount += 1;
        return { rowCount: 1, rows: [{ id: signalUpsertCount, inserted: signalUpsertCount === 1 }] };
      }
      return { rowCount: 1, rows: [] };
    },
  });
  const store = createMothershipStore({ database });
  const feedback = {
    id: "feedback_1",
    classification: "bug",
    status: "new",
    createdAt: "2026-06-10T10:00:00.000Z",
    context: { activeMatterName: "Example Matter" },
  };
  const signal = {
    id: "signal_1",
    source: "job_status",
    severity: "error",
    fingerprint: "fingerprint-1",
    matterName: "Example Matter",
    occurrenceCount: 2,
    firstSeenAt: "2026-06-10T09:00:00.000Z",
    lastSeenAt: "2026-06-10T10:00:00.000Z",
  };

  assert.equal((await store.ingestFeedback({ installationId: "firm-beta-01", feedback })).inserted, true);
  assert.equal((await store.ingestFeedback({ installationId: "firm-beta-01", feedback })).inserted, false);
  assert.equal((await store.ingestSignal({ installationId: "firm-beta-01", signal })).inserted, true);
  assert.equal((await store.ingestSignal({ installationId: "firm-beta-01", signal })).inserted, false);

  const inserts = calls.filter((call) => /insert into mothership_(feedback|signal)_events/i.test(call.text));
  assert.equal(inserts.length, 4);
  for (const call of inserts) {
    assert.match(call.text, /\$1/);
  }
  assert.match(inserts[0].text, /on conflict \(installation_id, feedback_id\) do nothing/i);
  assert.match(inserts[2].text, /on conflict \(installation_id, signal_id\) do update/i);
  assert.match(inserts[2].text, /greatest\(mothership_signal_events\.occurrence_count, excluded\.occurrence_count\)/i);
  assert.match(inserts[2].text, /status = case[\s\S]*mothership_signal_events\.status in \('resolved', 'superseded'\)[\s\S]*excluded\.source <> 'job_status'[\s\S]*then 'active'/i);
  assert.match(inserts[2].text, /where excluded\.status = 'active'/i);
  assert.match(inserts[2].text, /operatorStatusHistory/);
  assert.doesNotMatch(inserts[2].text, /where mothership_signal_events\.status = 'active'/i);
});

test("store accepts signal lifecycle updates by signal id or fingerprint", async () => {
  const calls = [];
  const database = fakeDatabase({
    onQuery(text, values) {
      calls.push({ text, values });
      if (/update mothership_signal_events/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 22, status: values[2] }] };
      }
      return { rowCount: 0, rows: [] };
    },
  });
  const store = createMothershipStore({ database });
  const result = await store.ingestSignal({
    installationId: "firm-beta-01",
    signal: {
      id: "signal_local_new_id",
      source: "job_status",
      severity: "error",
      status: "superseded",
      statusUpdatedAt: "2026-07-10T11:00:00.000Z",
      fingerprint: "same-failed-job-fingerprint",
      matterName: "Example Matter",
      occurrenceCount: 2,
      firstSeenAt: "2026-07-09T10:00:00.000Z",
      lastSeenAt: "2026-07-09T10:00:00.000Z",
    },
  });

  assert.deepEqual(result, { inserted: false, status: "superseded", lifecycleUpdated: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /set status = \$3/i);
  assert.match(calls[0].text, /signal_id = \$2 or fingerprint = \$6/i);
  assert.match(calls[0].text, /and status = 'active'/i);
  assert.deepEqual(calls[0].values.slice(0, 6), [
    "firm-beta-01",
    "signal_local_new_id",
    "superseded",
    "2026-07-10T11:00:00.000Z",
    JSON.stringify({
      id: "signal_local_new_id",
      source: "job_status",
      severity: "error",
      status: "superseded",
      statusUpdatedAt: "2026-07-10T11:00:00.000Z",
      fingerprint: "same-failed-job-fingerprint",
      matterName: "Example Matter",
      occurrenceCount: 2,
      firstSeenAt: "2026-07-09T10:00:00.000Z",
      lastSeenAt: "2026-07-09T10:00:00.000Z",
    }),
    "same-failed-job-fingerprint",
  ]);
});

test("store does not let ingested lifecycle signals overwrite already closed signals", async () => {
  const calls = [];
  const database = fakeDatabase({
    onQuery(text, values) {
      calls.push({ text, values });
      if (/update mothership_signal_events/i.test(text)) return { rowCount: 0, rows: [] };
      if (/select signal_id, status/i.test(text)) return { rowCount: 1, rows: [{ signal_id: "signal_existing", status: "suppressed" }] };
      if (/insert into mothership_signal_events/i.test(text)) throw new Error("closed signal should not be duplicated");
      return { rowCount: 0, rows: [] };
    },
  });
  const store = createMothershipStore({ database });

  const result = await store.ingestSignal({
    installationId: "firm-beta-01",
    signal: {
      id: "signal_local_new_id",
      source: "job_status",
      severity: "error",
      status: "superseded",
      statusUpdatedAt: "2026-07-10T11:00:00.000Z",
      fingerprint: "same-failed-job-fingerprint",
      occurrenceCount: 1,
      firstSeenAt: "2026-07-09T10:00:00.000Z",
      lastSeenAt: "2026-07-09T10:00:00.000Z",
    },
  });

  assert.deepEqual(result, { inserted: false, status: "suppressed", lifecycleUpdated: false });
  assert.equal(calls.filter((call) => /insert into mothership_signal_events/i.test(call.text)).length, 0);
  assert.deepEqual(calls[1].values, ["firm-beta-01", "signal_local_new_id", "same-failed-job-fingerprint"]);
});

test("store inserts metric snapshots and includes them in reports", async () => {
  const calls = [];
  const database = fakeDatabase({
    onQuery(text, values) {
      calls.push({ text, values });
      if (/insert into mothership_metric_snapshots/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 10, inserted: true }] };
      }
      if (/from mothership_metric_snapshots/i.test(text)) {
        return {
          rowCount: 1,
          rows: [{
            installation_id: "firm-beta-01",
            snapshot_id: "metrics_001",
            captured_at: "2026-06-10T10:00:00.000Z",
            received_at: "2026-06-10T10:00:01.000Z",
            payload: {
              id: "metrics_001",
              scores: {
                portability: 82,
                backendSuitability: 74,
                restoreConfidence: 60,
                capacityHeadroom: 70,
                userPatienceRisk: "medium",
              },
            },
          }],
        };
      }
      if (/from mothership_(feedback|signal)_events/i.test(text)) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    },
  });
  const store = createMothershipStore({ database });
  const metric = {
    id: "metrics_001",
    schema_version: "private-beta-metrics/v1",
    createdAt: "2026-06-10T10:00:00.000Z",
    scores: {
      portability: 82,
      backendSuitability: 74,
      restoreConfidence: 60,
      capacityHeadroom: 70,
      userPatienceRisk: "medium",
    },
  };

  assert.equal((await store.ingestMetricSnapshot({ installationId: "firm-beta-01", metric })).inserted, true);
  const report = await store.queryReport({ sinceDays: 7 });

  const insert = calls.find((call) => /insert into mothership_metric_snapshots/i.test(call.text));
  assert.ok(insert);
  assert.match(insert.text, /\$1/);
  assert.match(insert.text, /on conflict \(installation_id, snapshot_id\) do update/i);
  assert.equal(report.metrics.length, 1);
  assert.equal(report.metrics[0].snapshot_id, "metrics_001");
});

test("store inserts heartbeat events and includes them in reports", async () => {
  const calls = [];
  const database = fakeDatabase({
    onQuery(text, values) {
      calls.push({ text, values });
      if (/insert into mothership_heartbeat_events/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 11, inserted: true }] };
      }
      if (/from mothership_heartbeat_events/i.test(text)) {
        return {
          rowCount: 1,
          rows: [{
            installation_id: "firm-beta-01",
            heartbeat_id: "heartbeat_001",
            captured_at: "2026-06-13T10:00:00.000Z",
            received_at: "2026-06-13T10:00:01.000Z",
            payload: {
              id: "heartbeat_001",
              schema_version: "private-beta-heartbeat/v1",
              activeSessions: 1,
            },
          }],
        };
      }
      if (/from mothership_(feedback|signal)_events|from mothership_metric_snapshots/i.test(text)) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    },
  });
  const store = createMothershipStore({ database });
  const heartbeat = {
    id: "heartbeat_001",
    schema_version: "private-beta-heartbeat/v1",
    createdAt: "2026-06-13T10:00:00.000Z",
    activeSessions: 1,
  };

  assert.equal((await store.ingestHeartbeat({ installationId: "firm-beta-01", heartbeat })).inserted, true);
  const report = await store.queryReport({ sinceDays: 7 });

  const insert = calls.find((call) => /insert into mothership_heartbeat_events/i.test(call.text));
  assert.ok(insert);
  assert.match(insert.text, /\$1/);
  assert.match(insert.text, /on conflict \(installation_id, heartbeat_id\) do update/i);
  assert.equal(report.heartbeats.length, 1);
  assert.equal(report.heartbeats[0].heartbeat_id, "heartbeat_001");
});

test("store updates feedback status with bounded operator audit metadata", async () => {
  const calls = [];
  const database = fakeDatabase({
    onQuery(text, values) {
      calls.push({ text, values });
      if (/update mothership_feedback_events/i.test(text)) {
        return { rowCount: values[1] === "feedback_missing" ? 0 : 1, rows: values[1] === "feedback_missing" ? [] : [{ id: 12 }] };
      }
      return { rowCount: 1, rows: [] };
    },
  });
  const store = createMothershipStore({
    database,
    now: () => new Date("2026-06-17T15:30:00.000Z"),
  });

  assert.deepEqual(
    await store.updateFeedbackStatus({
      installationId: "firm-beta-01",
      feedbackId: "feedback_1",
      status: "needs_evidence",
      actor: "aks operator",
      note: "Need repro; token=super-secret should not persist.",
    }),
    {
      updated: true,
      status: "needs_evidence",
      updatedAt: "2026-06-17T15:30:00.000Z",
      actor: "aks operator",
      note: "Need repro; token=[redacted-secret] should not persist.",
    },
  );
  assert.deepEqual(
    await store.updateFeedbackStatus({ installationId: "firm-beta-01", feedbackId: "feedback_missing", status: "parked" }),
    {
      updated: false,
      status: "parked",
      updatedAt: "2026-06-17T15:30:00.000Z",
      actor: "operator",
      note: "",
    },
  );
  await assert.rejects(
    () => store.updateFeedbackStatus({ installationId: "firm-beta-01", feedbackId: "feedback_1", status: "product_backlog" }),
    (error) => error.statusCode === 400 && /feedback status must be one of/i.test(error.message),
  );

  const updates = calls.filter((call) => /update mothership_feedback_events/i.test(call.text));
  assert.equal(updates.length, 2);
  assert.match(updates[0].text, /jsonb_set\(payload, '\{status\}'/i);
  assert.match(updates[0].text, /operatorTriageHistory/i);
  assert.deepEqual(updates[0].values, [
    "firm-beta-01",
    "feedback_1",
    "needs_evidence",
    "2026-06-17T15:30:00.000Z",
    "aks operator",
    "Need repro; token=[redacted-secret] should not persist.",
  ]);
  assert.match(updates[0].text, /where installation_id = \$1 and feedback_id = \$2/i);
  assert.doesNotMatch(JSON.stringify(updates), /super-secret/);
});

test("store updates signal lifecycle status with bounded operator audit metadata", async () => {
  const calls = [];
  const database = fakeDatabase({
    onQuery(text, values) {
      calls.push({ text, values });
      if (/update mothership_signal_events/i.test(text)) {
        return values[1] === "signal_missing"
          ? { rowCount: 0, rows: [] }
          : { rowCount: 1, rows: [{ signal_id: values[1], fingerprint: "fingerprint-1", status: values[2] }] };
      }
      return { rowCount: 1, rows: [] };
    },
  });
  const store = createMothershipStore({
    database,
    now: () => new Date("2026-07-10T12:00:00.000Z"),
  });

  assert.deepEqual(
    await store.updateSignalStatus({
      installationId: "firm-beta-01",
      signalId: "signal_1",
      status: "superseded",
      actor: "operator bot",
      note: "Later same-kind job succeeded; password=hunter2 should be redacted.",
    }),
    {
      updated: true,
      signalId: "signal_1",
      fingerprint: "fingerprint-1",
      status: "superseded",
      updatedAt: "2026-07-10T12:00:00.000Z",
      actor: "operator bot",
      note: "Later same-kind job succeeded; password=[redacted-secret] should be redacted.",
    },
  );
  assert.deepEqual(
    await store.updateSignalStatus({ installationId: "firm-beta-01", signalId: "signal_missing", status: "resolved" }),
    {
      updated: false,
      signalId: "signal_missing",
      fingerprint: "",
      status: "resolved",
      updatedAt: "2026-07-10T12:00:00.000Z",
      actor: "operator",
      note: "",
    },
  );
  await assert.rejects(
    () => store.updateSignalStatus({ installationId: "firm-beta-01", signalId: "signal_1", status: "fixed" }),
    (error) => error.statusCode === 400 && /signal status must be one of/i.test(error.message),
  );

  const updates = calls.filter((call) => /update mothership_signal_events/i.test(call.text));
  assert.equal(updates.length, 2);
  assert.match(updates[0].text, /set status = \$3/i);
  assert.match(updates[0].text, /status_updated_at = \$4::timestamptz/i);
  assert.match(updates[0].text, /operatorStatusHistory/i);
  assert.deepEqual(updates[0].values, [
    "firm-beta-01",
    "signal_1",
    "superseded",
    "2026-07-10T12:00:00.000Z",
    "operator bot",
    "Later same-kind job succeeded; password=[redacted-secret] should be redacted.",
  ]);
  assert.match(updates[0].text, /where installation_id = \$1 and signal_id = \$2/i);
  assert.doesNotMatch(JSON.stringify(updates), /hunter2/);
});

test("store revokes installations and prunes expired payloads", async () => {
  const calls = [];
  const database = fakeDatabase({
    onQuery(text, values) {
      calls.push({ text, values });
      if (/delete from mothership_feedback_events/i.test(text)) return { rowCount: 3, rows: [] };
      if (/delete from mothership_signal_events/i.test(text)) return { rowCount: 4, rows: [] };
      if (/delete from mothership_metric_snapshots/i.test(text)) return { rowCount: 5, rows: [] };
      if (/delete from mothership_heartbeat_events/i.test(text)) return { rowCount: 6, rows: [] };
      return { rowCount: 1, rows: [] };
    },
  });
  const store = createMothershipStore({ database });

  const revoked = await store.revokeInstallation({ installationId: "firm-beta-01" });
  assert.equal(revoked, true);
  assert.equal(calls.filter((call) => /update mothership_(installations|ingestion_tokens)/i.test(call.text)).length, 2);

  const pruned = await store.pruneExpired({ retentionDays: 180 });
  assert.deepEqual(pruned, { feedbackDeleted: 3, signalsDeleted: 4, metricsDeleted: 5, heartbeatsDeleted: 6, retentionDays: 180 });
  assert.equal(calls.filter((call) => /delete from mothership_(feedback|signal|heartbeat)_events|delete from mothership_metric_snapshots/i.test(call.text)).length, 4);
});

test("store queryReport filters by installationId when provided", async () => {
  const calls = [];
  const database = fakeDatabase({
    onQuery(text, values) {
      calls.push({ text, values });
      if (/from mothership_feedback_events/i.test(text)) {
        return { rowCount: 1, rows: [{ installation_id: "firm-beta-01", feedback_id: "fb_1", classification: "bug", status: "new", occurred_at: null, received_at: null, payload: {} }] };
      }
      return { rowCount: 0, rows: [] };
    },
  });
  const store = createMothershipStore({ database });

  const report = await store.queryReport({ sinceDays: 7, installationId: "firm-beta-01" });

  const filtered = calls.filter((call) => /and installation_id = \$2/i.test(call.text));
  assert.equal(filtered.length, 4);
  for (const call of filtered) {
    assert.deepEqual(call.values, [7, "firm-beta-01"]);
  }
  assert.equal(report.installationId, "firm-beta-01");
  assert.equal(report.sinceDays, 7);
  assert.equal(report.feedback.length, 1);
  assert.equal(report.feedback[0].installation_id, "firm-beta-01");
});

test("store queryReport without installationId preserves the original single-parameter shape", async () => {
  const calls = [];
  const database = fakeDatabase({
    onQuery() {
      return { rowCount: 0, rows: [] };
    },
  });
  const store = createMothershipStore({ database });

  const report = await store.queryReport({ sinceDays: 30 });

  assert.equal("installationId" in report, false);
  for (const call of calls) {
    assert.doesNotMatch(call.text, /installation_id = \$2/i);
    assert.equal(call.values.length, 1);
  }
});

test("store queryReport rejects an invalid installationId filter", async () => {
  const database = fakeDatabase({ onQuery: () => ({ rowCount: 0, rows: [] }) });
  const store = createMothershipStore({ database });

  await assert.rejects(
    () => store.queryReport({ installationId: "bad id!" }),
    (error) => error.statusCode === 400 && /installationId is invalid/i.test(error.message),
  );
});

test("store listInstallations maps fleet rows with heartbeat age and recent counts", async () => {
  const calls = [];
  const database = fakeDatabase({
    onQuery(text, values) {
      calls.push({ text, values });
      if (/from mothership_installations i/i.test(text)) {
        return {
          rowCount: 2,
          rows: [
            {
              installation_id: "firm-beta-01",
              label: "Firm beta one",
              status: "active",
              created_at: new Date("2026-05-01T00:00:00.000Z"),
              updated_at: new Date("2026-06-10T00:00:00.000Z"),
              revoked_at: null,
              latest_heartbeat_received_at: new Date("2026-06-20T09:00:00.000Z"),
              recent_signal_count: 3,
              recent_feedback_count: 2,
            },
            {
              installation_id: "firm-beta-02",
              label: "Firm beta two",
              status: "revoked",
              created_at: new Date("2026-04-01T00:00:00.000Z"),
              updated_at: new Date("2026-06-01T00:00:00.000Z"),
              revoked_at: new Date("2026-06-01T00:00:00.000Z"),
              latest_heartbeat_received_at: null,
              recent_signal_count: 0,
              recent_feedback_count: 0,
            },
          ],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  });
  const store = createMothershipStore({ database });

  const result = await store.listInstallations({ sinceDays: 30 });

  const fleetQuery = calls.find((call) => /from mothership_installations i/i.test(call.text));
  assert.ok(fleetQuery);
  assert.match(fleetQuery.text, /left join \(.*max\(received_at\).*mothership_heartbeat_events/is);
  assert.match(fleetQuery.text, /count\(\*\).*mothership_signal_events/is);
  assert.match(fleetQuery.text, /where status = 'active'/i);
  assert.match(fleetQuery.text, /count\(\*\).*mothership_feedback_events/is);
  assert.match(fleetQuery.text, /order by i\.created_at desc/is);
  assert.deepEqual(fleetQuery.values, [30]);

  assert.equal(result.sinceDays, 30);
  assert.equal(result.installations.length, 2);
  assert.deepEqual(result.installations[0], {
    installationId: "firm-beta-01",
    label: "Firm beta one",
    status: "active",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    revokedAt: null,
    latestHeartbeatReceivedAt: "2026-06-20T09:00:00.000Z",
    recentSignalCount: 3,
    recentFeedbackCount: 2,
  });
  assert.equal(result.installations[1].latestHeartbeatReceivedAt, null);
  assert.equal(result.installations[1].revokedAt, "2026-06-01T00:00:00.000Z");
  assert.equal(result.installations[1].recentSignalCount, 0);
});

test("store listInstallations defaults to a 30-day window and returns an empty list", async () => {
  const calls = [];
  const database = fakeDatabase({
    onQuery(text, values) {
      calls.push({ text, values });
      return { rowCount: 0, rows: [] };
    },
  });
  const store = createMothershipStore({ database });

  const result = await store.listInstallations();

  assert.equal(result.sinceDays, 30);
  assert.deepEqual(result.installations, []);
  assert.deepEqual(calls[0].values, [30]);
});

test("store uses the shared mothership httpError helper instead of a local unredacted twin", async () => {
  const source = await readFile(new URL("../mothership/store.mjs", import.meta.url), "utf8");

  assert.match(source, /import \{ httpError \} from "\.\/http\.mjs";/);
  assert.doesNotMatch(source, /function\s+httpError\s*\(/);
});

function fakeDatabase({ onQuery }) {
  return {
    query: async (text, values = []) => onQuery(text, values),
    transaction: async (operation) => operation({ query: async (text, values = []) => onQuery(text, values) }),
  };
}
