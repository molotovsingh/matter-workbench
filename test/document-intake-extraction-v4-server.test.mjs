import assert from "node:assert/strict";
import test from "node:test";

import {
  closeDocumentIntakeExtractionServer,
  createDocumentIntakeExtractionHttpServer,
  listenDocumentIntakeExtractionServer,
} from "../services/document-intake-extraction/http/standalone-http-server.mjs";

// V4-API-001 independently runnable HTTP boundary evidence
test("standalone server exposes minimal health, delegates versioned API, and closes gracefully", async () => {
  let ready = true;
  let delegated = 0;
  const server = createDocumentIntakeExtractionHttpServer({
    readinessCheck: async () => ({ ready }),
    handler: async (_request, response) => {
      delegated += 1;
      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ delegated: true }));
    },
  });
  const address = await listenDocumentIntakeExtractionServer(server, { host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const live = await fetch(`${base}/health/live`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { schemaVersion: "document-intake-extraction.health/v1", status: "live" });
    assert.equal(live.headers.get("cache-control"), "no-store");
    assert.equal(delegated, 0);

    assert.equal((await fetch(`${base}/health/ready`)).status, 200);
    ready = false;
    const unavailable = await fetch(`${base}/health/ready`);
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { schemaVersion: "document-intake-extraction.health/v1", status: "unavailable" });

    const api = await fetch(`${base}/v1/intakes/example`);
    assert.equal(api.status, 202);
    assert.equal(delegated, 1);
  } finally {
    await closeDocumentIntakeExtractionServer(server);
  }
});

test("standalone readiness fails closed on timeout without exposing dependency errors", async () => {
  const server = createDocumentIntakeExtractionHttpServer({
    readinessTimeoutMs: 10,
    readinessCheck: async () => new Promise(() => {}),
    handler: async () => {},
  });
  const address = await listenDocumentIntakeExtractionServer(server, { host: "127.0.0.1", port: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /timeout|database|object store/i);
  } finally {
    await closeDocumentIntakeExtractionServer(server);
  }
});
