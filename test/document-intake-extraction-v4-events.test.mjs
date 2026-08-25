import assert from "node:assert/strict";
import test from "node:test";

import { OutboxDispatcher, createHttpEventDelivery, retryDelay } from "../services/document-intake-extraction/events/outbox-dispatcher.mjs";

// V4-OUTBOX-001
test("V4-OUTBOX-001 dispatches leased outbox events with idempotency and distinguishes retry from dead letter", async () => {
  const events = [event("event-1", 1), event("event-2", 2), event("event-3", 1)];
  const delivered = [];
  const failed = [];
  const seen = [];
  const store = {
    async claim(input) {
      assert.equal(input.tenantId, "tenant-1");
      return events;
    },
    async markDelivered(input) { delivered.push(input); },
    async markFailed(input) { failed.push(input); },
  };
  const dispatcher = new OutboxDispatcher({
    store,
    baseRetryMs: 1_000,
    maximumRetryMs: 60_000,
    async deliver(current, options) {
      seen.push({ current, options });
      if (current.eventId === "event-2") throw Object.assign(new Error("receiver unavailable"), { code: "outbox.http_503", retryable: true });
      if (current.eventId === "event-3") throw Object.assign(new Error("receiver rejected schema"), { code: "outbox.http_400", retryable: false });
    },
  });
  const outcomes = await dispatcher.drainTenant({ tenantId: "tenant-1", workerId: "dispatcher-1" });
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["delivered", "failed", "dead_letter"]);
  assert.equal(seen[0].options.idempotencyKey, "event-1");
  assert.deepEqual(delivered, [{ tenantId: "tenant-1", eventId: "event-1", leaseToken: "lease-event-1" }]);
  assert.equal(failed[0].retryAfterMs, 2_000);
  assert.equal(failed[0].terminal, false);
  assert.equal(failed[1].terminal, true);
  assert.equal(outcomes[2].retryAfterMs, null);
  assert.equal(retryDelay(20, 1_000, 60_000), 60_000);
});

test("HTTP event delivery requires HTTPS and sends only the versioned payload with a stable idempotency key", async () => {
  assert.throws(() => createHttpEventDelivery({ endpoint: "http://events.example.com", bearerToken: "secret" }), /requires HTTPS/);
  const requests = [];
  const deliver = createHttpEventDelivery({
    endpoint: "https://events.example.com/v1/extraction-events",
    bearerToken: "delivery-secret",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init, body: JSON.parse(init.body) });
      return new Response(null, { status: 204 });
    },
  });
  await deliver(event("event-http", 1), { idempotencyKey: "event-http" });
  assert.equal(requests[0].init.headers["Idempotency-Key"], "event-http");
  assert.equal(requests[0].init.headers["X-Event-Type"], "extraction.result.ready");
  assert.equal(requests[0].init.headers.Authorization, "Bearer delivery-secret");
  assert.deepEqual(requests[0].body, event("event-http", 1).payload);
});

function event(eventId, attemptCount) {
  return {
    eventId,
    tenantId: "tenant-1",
    matterId: "matter-1",
    intakeId: "intake-1",
    resultId: "result-1",
    type: "extraction.result.ready",
    schemaVersion: "document-intake-extraction.event/v1",
    payload: {
      schemaVersion: "document-intake-extraction.event/v1",
      type: "extraction.result.ready",
      eventId,
      intakeId: "intake-1",
      resultId: "result-1",
    },
    attemptCount,
    leaseToken: `lease-${eventId}`,
  };
}
