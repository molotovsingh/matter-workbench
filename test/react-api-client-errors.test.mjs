import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);

test("React API client hides raw HTML gateway errors from preparation stages", async () => {
  const { api } = await importReactApiClient();
  const restoreFetch = mockFetch(async (url) => {
    assert.equal(url, "/api/extract");
    return new Response(`<!doctype html>
<html>
<head><title>504 Gateway Time-out</title></head>
<body><center><h1>504 Gateway Time-out</h1></center><hr><center>nginx/1.24.0 (Ubuntu)</center></body>
</html>`, {
      status: 504,
      statusText: "Gateway Timeout",
      headers: { "content-type": "text/html" },
    });
  });

  try {
    await assert.rejects(
      () => api.runExtract({ matterName: "Demo Matter", forceRefresh: true }),
      (error) => {
        assert.equal(error.statusCode, 504);
        assert.equal(error.code, "preparation.extract_timeout");
        assert.match(error.message, /Reading documents took too long/i);
        assert.doesNotMatch(error.message, /<html|<head|nginx|504|Gateway/i);
        assert.deepEqual(error.diagnostic, {
          statusCode: 504,
          code: "preparation.extract_timeout",
          statusText: "Gateway Timeout",
          urlPath: "/api/extract",
          bodyKind: "html",
          htmlTitle: "504 Gateway Time-out",
        });
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

test("React API client still preserves plain text API errors", async () => {
  const { api } = await importReactApiClient();
  const restoreFetch = mockFetch(async () => new Response("Matter already exists", {
    status: 409,
    statusText: "Conflict",
    headers: { "content-type": "text/plain" },
  }));

  try {
    await assert.rejects(
      () => api.runMatterInit({ matterName: "Demo Matter" }),
      (error) => error.statusCode === 409 && error.message === "Matter already exists",
    );
  } finally {
    restoreFetch();
  }
});

test("React API client preserves structured API error codes", async () => {
  const { api } = await importReactApiClient();
  const restoreFetch = mockFetch(async () => new Response(JSON.stringify({
    error: "Attach at least one source file.",
    code: "upload.no_files_attached",
  }), {
    status: 400,
    statusText: "Bad Request",
    headers: { "content-type": "application/json" },
  }));

  try {
    await assert.rejects(
      () => api.runMatterInit({ matterName: "Demo Matter" }),
      (error) => {
        assert.equal(error.statusCode, 400);
        assert.equal(error.code, "upload.no_files_attached");
        assert.equal(error.message, "Attach at least one source file.");
        assert.equal(error.diagnostic.code, "upload.no_files_attached");
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

async function importReactApiClient() {
  const source = await readFile(apiClientPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  }).outputText;
  const dir = await mkdtemp(path.join(os.tmpdir(), "mwb-react-api-client-"));
  const modulePath = path.join(dir, "client.mjs");
  await writeFile(modulePath, compiled);
  try {
    return await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function mockFetch(fetchImpl) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return () => {
    globalThis.fetch = originalFetch;
  };
}
