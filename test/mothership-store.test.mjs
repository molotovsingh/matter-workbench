import assert from "node:assert/strict";
import test from "node:test";

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

test("store updates feedback status through a parameterized payload patch", async () => {
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
  const store = createMothershipStore({ database });

  assert.deepEqual(
    await store.updateFeedbackStatus({ installationId: "firm-beta-01", feedbackId: "feedback_1", status: "needs_evidence" }),
    { updated: true, status: "needs_evidence" },
  );
  assert.deepEqual(
    await store.updateFeedbackStatus({ installationId: "firm-beta-01", feedbackId: "feedback_missing", status: "parked" }),
    { updated: false, status: "parked" },
  );
  await assert.rejects(
    () => store.updateFeedbackStatus({ installationId: "firm-beta-01", feedbackId: "feedback_1", status: "product_backlog" }),
    (error) => error.statusCode === 400 && /feedback status must be one of/i.test(error.message),
  );

  const updates = calls.filter((call) => /update mothership_feedback_events/i.test(call.text));
  assert.equal(updates.length, 2);
  assert.match(updates[0].text, /jsonb_set\(payload, '\{status\}'/i);
  assert.deepEqual(updates[0].values, ["firm-beta-01", "feedback_1", "needs_evidence"]);
  assert.match(updates[0].text, /where installation_id = \$1 and feedback_id = \$2/i);
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

function fakeDatabase({ onQuery }) {
  return {
    query: async (text, values = []) => onQuery(text, values),
    transaction: async (operation) => operation({ query: async (text, values = []) => onQuery(text, values) }),
  };
}
