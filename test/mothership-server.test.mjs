import assert from "node:assert/strict";
import test from "node:test";

import { createMothershipServer } from "../mothership/server.mjs";

test("mothership receiver ingests authenticated feedback and signals", async () => {
  const calls = [];
  const store = createFakeStore({ calls });
  const app = await startServer(store);
  try {
    const health = await getJson(app.baseUrl, "/health");
    assert.deepEqual(health, { schema_version: "mothership-health/v1", status: "ready", database: "ready" });

    const feedbackPayload = {
      schema_version: "private-beta-feedback-sync/v1",
      installId: "firm-beta-01",
      feedback: {
        schema_version: "private-beta-feedback/v1",
        id: "feedback_001",
        choice: "did_not_work",
        classification: "bug",
        status: "new",
        tryingToDo: "Run Source Labels",
        createdAt: "2026-06-10T10:00:00.000Z",
        context: {},
      },
    };
    const feedback = await postJson(app.baseUrl, "/v1/feedback", feedbackPayload, "mwb_ing_test-token");
    assert.equal(feedback.response.status, 202);
    assert.deepEqual(feedback.body, { accepted: true, duplicate: false, schema_version: "mothership-ingestion-result/v1" });

    const signalPayload = {
      schema_version: "private-beta-signal-sync/v1",
      installId: "firm-beta-01",
      signal: {
        schema_version: "private-beta-signal/v1",
        id: "signal_001",
        source: "job_status",
        severity: "error",
        fingerprint: "job-failed-1",
        occurrenceCount: 1,
        createdAt: "2026-06-10T10:00:00.000Z",
        firstSeenAt: "2026-06-10T10:00:00.000Z",
        lastSeenAt: "2026-06-10T10:00:00.000Z",
      },
    };
    const signal = await postJson(app.baseUrl, "/v1/signals", signalPayload, "mwb_ing_test-token");
    assert.equal(signal.response.status, 202);
    assert.equal(signal.body.accepted, true);

    const metricsPayload = {
      schema_version: "private-beta-metrics-sync/v1",
      installId: "firm-beta-01",
      metric: {
        schema_version: "private-beta-metrics/v1",
        id: "metrics_001",
        createdAt: "2026-06-10T10:00:00.000Z",
        scores: {
          backendSuitability: 74,
          portability: 82,
          userPatienceRisk: "medium",
        },
      },
    };
    const metrics = await postJson(app.baseUrl, "/v1/metrics", metricsPayload, "mwb_ing_test-token");
    assert.equal(metrics.response.status, 202);
    assert.equal(metrics.body.accepted, true);

    assert.deepEqual(calls.map((call) => call.type), ["health", "authorize", "feedback", "authorize", "signal", "authorize", "metric"]);
    assert.equal(calls[1].rawToken, "mwb_ing_test-token");
  } finally {
    await app.close();
  }
});

test("mothership receiver treats duplicate delivery as accepted", async () => {
  const store = createFakeStore({ duplicate: true });
  const app = await startServer(store);
  try {
    const result = await postJson(app.baseUrl, "/v1/feedback", validFeedbackPayload(), "token");
    assert.equal(result.response.status, 202);
    assert.equal(result.body.accepted, true);
    assert.equal(result.body.duplicate, true);
  } finally {
    await app.close();
  }
});

test("mothership receiver rejects malformed, oversized, unsupported, and unauthenticated requests", async () => {
  const store = createFakeStore();
  const app = await startServer(store, { maxBodyBytes: 1024 });
  try {
    const missing = await fetch(`${app.baseUrl}/v1/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validFeedbackPayload()),
    });
    assert.equal(missing.status, 401);

    const malformed = await fetch(`${app.baseUrl}/v1/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
      body: "{broken",
    });
    assert.equal(malformed.status, 400);

    const wrongSchema = await postJson(app.baseUrl, "/v1/feedback", { ...validFeedbackPayload(), schema_version: "wrong" }, "token");
    assert.equal(wrongSchema.response.status, 400);

    const oversized = await fetch(`${app.baseUrl}/v1/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
      body: JSON.stringify({ ...validFeedbackPayload(), padding: "x".repeat(1600) }),
    });
    assert.equal(oversized.status, 413);

    assert.equal((await fetch(`${app.baseUrl}/missing`)).status, 404);
    assert.equal((await fetch(`${app.baseUrl}/health`, { method: "POST" })).status, 405);
  } finally {
    await app.close();
  }
});

test("mothership receiver preserves authorization status without leaking tokens", async () => {
  for (const statusCode of [401, 403]) {
    const store = createFakeStore({ authorizationStatus: statusCode });
    const app = await startServer(store);
    try {
      const result = await postJson(app.baseUrl, "/v1/feedback", validFeedbackPayload(), "super-secret-token");
      assert.equal(result.response.status, statusCode);
      assert.doesNotMatch(JSON.stringify(result.body), /super-secret-token/);
    } finally {
      await app.close();
    }
  }
});

async function startServer(store, options = {}) {
  const app = createMothershipServer({ store, host: "127.0.0.1", port: 0, ...options });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, baseUrl, close: () => new Promise((resolve) => app.server.close(resolve)) };
}

function createFakeStore({ calls = [], duplicate = false, authorizationStatus = 0 } = {}) {
  return {
    health: async () => {
      calls.push({ type: "health" });
      return { database: "ready" };
    },
    authorizeIngestion: async ({ rawToken, installationId }) => {
      calls.push({ type: "authorize", rawToken, installationId });
      if (authorizationStatus) {
        const error = new Error(authorizationStatus === 401 ? "Invalid ingestion token" : "Installation revoked");
        error.statusCode = authorizationStatus;
        throw error;
      }
      return { installationId };
    },
    ingestFeedback: async ({ installationId, feedback }) => {
      calls.push({ type: "feedback", installationId, feedback });
      return { inserted: !duplicate };
    },
    ingestSignal: async ({ installationId, signal }) => {
      calls.push({ type: "signal", installationId, signal });
      return { inserted: !duplicate };
    },
    ingestMetricSnapshot: async ({ installationId, metric }) => {
      calls.push({ type: "metric", installationId, metric });
      return { inserted: !duplicate };
    },
  };
}

function validFeedbackPayload() {
  return {
    schema_version: "private-beta-feedback-sync/v1",
    installId: "firm-beta-01",
    feedback: {
      schema_version: "private-beta-feedback/v1",
      id: "feedback_001",
      choice: "confused",
      classification: "confusing_ux",
      status: "new",
      tryingToDo: "Understand the matter home",
      createdAt: "2026-06-10T10:00:00.000Z",
      context: {},
    },
  };
}

async function getJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  assert.equal(response.ok, true);
  return response.json();
}

async function postJson(baseUrl, pathname, body, token) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}
