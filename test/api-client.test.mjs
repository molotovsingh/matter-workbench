import assert from "node:assert/strict";
import test from "node:test";
import { getJson, postFormData, postJson } from "../frontend/api-client.js";

test("frontend API client parses GET JSON payloads", async () => {
  const restoreFetch = mockFetch(async (url) => {
    assert.equal(url, "/api/config");
    return jsonResponse({ ok: true });
  });

  try {
    assert.deepEqual(await getJson("/api/config"), { ok: true });
  } finally {
    restoreFetch();
  }
});

test("frontend API client posts JSON with content type and string body", async () => {
  const restoreFetch = mockFetch(async (url, init = {}) => {
    assert.equal(url, "/api/example");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["content-type"], "application/json");
    assert.equal(init.body, JSON.stringify({ hello: "world" }));
    return jsonResponse({ saved: true });
  });

  try {
    assert.deepEqual(await postJson("/api/example", { hello: "world" }), { saved: true });
  } finally {
    restoreFetch();
  }
});

test("frontend API client posts FormData without JSON headers", async () => {
  const formData = new FormData();
  formData.append("name", "Matter");
  const restoreFetch = mockFetch(async (url, init = {}) => {
    assert.equal(url, "/api/matters/new");
    assert.equal(init.method, "POST");
    assert.equal(init.body, formData);
    assert.equal(init.headers, undefined);
    return jsonResponse({ created: true });
  });

  try {
    assert.deepEqual(await postFormData("/api/matters/new", formData), { created: true });
  } finally {
    restoreFetch();
  }
});

test("frontend API client preserves HTTP status on JSON errors", async () => {
  const restoreFetch = mockFetch(async () => jsonResponse({ error: "Matter already exists" }, { ok: false, status: 409 }));

  try {
    await assert.rejects(
      () => postJson("/api/example", {}),
      (error) => error.message === "Matter already exists" && error.statusCode === 409,
    );
  } finally {
    restoreFetch();
  }
});

function mockFetch(fetchImpl) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}
