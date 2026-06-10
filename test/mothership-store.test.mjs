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

test("store revokes installations and prunes expired payloads", async () => {
  const calls = [];
  const database = fakeDatabase({
    onQuery(text, values) {
      calls.push({ text, values });
      if (/delete from mothership_feedback_events/i.test(text)) return { rowCount: 3, rows: [] };
      if (/delete from mothership_signal_events/i.test(text)) return { rowCount: 4, rows: [] };
      return { rowCount: 1, rows: [] };
    },
  });
  const store = createMothershipStore({ database });

  const revoked = await store.revokeInstallation({ installationId: "firm-beta-01" });
  assert.equal(revoked, true);
  assert.equal(calls.filter((call) => /update mothership_(installations|ingestion_tokens)/i.test(call.text)).length, 2);

  const pruned = await store.pruneExpired({ retentionDays: 180 });
  assert.deepEqual(pruned, { feedbackDeleted: 3, signalsDeleted: 4, retentionDays: 180 });
  assert.equal(calls.filter((call) => /delete from mothership_(feedback|signal)_events/i.test(call.text)).length, 2);
});

function fakeDatabase({ onQuery }) {
  return {
    query: async (text, values = []) => onQuery(text, values),
    transaction: async (operation) => operation({ query: async (text, values = []) => onQuery(text, values) }),
  };
}
