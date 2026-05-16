import assert from "node:assert/strict";
import test from "node:test";
import { readWorkspaceFile, readWorkspaceTextFile } from "../frontend/workspace-files.js";

test("workspace file helper reads preview payloads through encoded file API path", async () => {
  const restoreFetch = mockFetch(async (url) => {
    assert.equal(url, "/api/file?path=10_Library%2FList%20of%20Dates.md");
    return jsonResponse({
      path: "10_Library/List of Dates.md",
      content: "# List of Dates",
    });
  });

  try {
    assert.equal(await readWorkspaceTextFile("10_Library/List of Dates.md"), "# List of Dates");
  } finally {
    restoreFetch();
  }
});

test("workspace file helper maps file API errors to readable messages", async () => {
  const restoreFetch = mockFetch(async () => jsonResponse({ error: "Blocked file" }, { ok: false, status: 403 }));

  try {
    await assert.rejects(() => readWorkspaceFile("../.env"), /Blocked file/);
  } finally {
    restoreFetch();
  }
});

test("workspace file helper rejects non-text preview payloads for markdown copy", async () => {
  const restoreFetch = mockFetch(async () => jsonResponse({ path: "10_Library/List of Dates.md" }));

  try {
    await assert.rejects(() => readWorkspaceTextFile("10_Library/List of Dates.md"), /did not include text content/);
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
