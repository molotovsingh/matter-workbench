import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);
const reactSecretRedactionPath = new URL("../react-ui/src/lib/secretRedaction.ts", import.meta.url);
const reactWorkspaceLabelsPath = new URL("../react-ui/src/lib/workspaceLabels.ts", import.meta.url);

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

test("React API client hides raw plain-text gateway errors from preparation stages", async () => {
  const { api } = await importReactApiClient();
  const restoreFetch = mockFetch(async (url) => {
    assert.equal(url, "/api/extract");
    return new Response("504 Gateway Time-out\nnginx/1.24.0 (Ubuntu)", {
      status: 504,
      statusText: "Gateway Timeout",
      headers: { "content-type": "text/plain" },
    });
  });

  try {
    await assert.rejects(
      () => api.runExtract({ matterName: "Demo Matter", forceRefresh: true }),
      (error) => {
        assert.equal(error.statusCode, 504);
        assert.equal(error.code, "preparation.extract_timeout");
        assert.match(error.message, /Reading documents took too long/i);
        assert.doesNotMatch(error.message, /nginx|Gateway Time-out/i);
        assert.equal(error.diagnostic.bodyKind, "text");
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

test("React API client redacts fallback URLs and payload secrets", async () => {
  const { api } = await importReactApiClient();
  const restoreFetch = mockFetch(async (url) => {
    assert.match(String(url), /matter=Smith\+v\+Jones/);
    return new Response("", {
      status: 404,
      statusText: "Not Found",
    });
  });

  try {
    await assert.rejects(
      () => api.getFile("10_Library/List of Dates.md", "Smith v Jones"),
      (error) => {
        assert.equal(error.statusCode, 404);
        assert.equal(error.message, "The server rejected this request (404 Not Found). Please check the form and try again.");
        assert.doesNotMatch(error.message, /Smith|List of Dates|\/api\/file/);
        assert.equal(error.diagnostic.urlPath, "/api/file?path=[redacted]&matter=[redacted]");
        return true;
      },
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

test("React API client hides raw HTML even when wrapped in JSON error fields", async () => {
  const { api } = await importReactApiClient();
  const restoreFetch = mockFetch(async () => new Response(JSON.stringify({
    error: "<html><head><title>504 Gateway Time-out</title></head><body><center>nginx/1.24.0</center></body></html>",
    code: "provider.error",
  }), {
    status: 502,
    statusText: "Bad Gateway",
    headers: { "content-type": "application/json" },
  }));

  try {
    await assert.rejects(
      () => api.planSkillIdeaInterview({ userRequest: "new skill", activeMatter: null, skillIdea: { mode: "new_skill" } }),
      (error) => {
        assert.equal(error.statusCode, 502);
        assert.equal(error.code, "provider.error");
        assert.match(error.message, /server could not complete this request/i);
        assert.doesNotMatch(error.message, /<html|<head|nginx|504 Gateway/i);
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

test("React API client prefers a clean JSON message over a contaminated error field", async () => {
  const { api } = await importReactApiClient();
  const restoreFetch = mockFetch(async () => new Response(JSON.stringify({
    error: "<html><head><title>504 Gateway Time-out</title></head><body><center>nginx/1.24.0</center></body></html>",
    message: "Provider returned an invalid response. Try again in a minute.",
    code: "provider.invalid_response",
  }), {
    status: 502,
    statusText: "Bad Gateway",
    headers: { "content-type": "application/json" },
  }));

  try {
    await assert.rejects(
      () => api.planSkillIdeaInterview({ userRequest: "new skill", activeMatter: null, skillIdea: { mode: "new_skill" } }),
      (error) => {
        assert.equal(error.statusCode, 502);
        assert.equal(error.code, "provider.invalid_response");
        assert.equal(error.message, "Provider returned an invalid response. Try again in a minute.");
        assert.doesNotMatch(error.message, /<html|<head|nginx|504 Gateway/i);
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

test("React API client redacts structured API error messages", async () => {
  const { api } = await importReactApiClient();
  const restoreFetch = mockFetch(async () => new Response(JSON.stringify({
    error: "provider rejected OPENAI_API_KEY=sk-client-secret",
    code: "provider.rejected",
  }), {
    status: 502,
    statusText: "Bad Gateway",
    headers: { "content-type": "application/json" },
  }));

  try {
    await assert.rejects(
      () => api.planSkillIdeaInterview({ userRequest: "new skill", activeMatter: null, skillIdea: { mode: "new_skill" } }),
      (error) => {
        assert.equal(error.message, "provider rejected OPENAI_API_KEY=[redacted-secret]");
        assert.doesNotMatch(error.message, /sk-client-secret/);
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

test("React API client uses shared workspace lane labels", async () => {
  const { adaptTree } = await importReactApiClient();
  const tree = adaptTree({
    kind: "directory",
    name: "Demo Matter",
    path: "",
    children: [{ kind: "directory", name: "00_Inbox", path: "00_Inbox", children: [] }],
  });

  assert.equal(tree.children[0].name, "Case Record");
  assert.equal(tree.children[0].canonical, "00_Inbox");
});

test("React API client turns upload network failures into user-safe messages", async () => {
  const { api } = await importReactApiClient();
  const restoreFetch = mockFetch(async () => {
    throw new TypeError("Failed to fetch");
  });
  const formData = new FormData();
  formData.append("name", "Demo Matter");

  try {
    await assert.rejects(
      () => api.newMatter(formData),
      (error) => {
        assert.equal(error.statusCode, 0);
        assert.equal(error.code, "upload.network_failed");
        assert.match(error.message, /upload could not reach the server/i);
        assert.doesNotMatch(error.message, /Failed to fetch/i);
        assert.deepEqual(error.diagnostic, {
          statusCode: 0,
          code: "upload.network_failed",
          urlPath: "/api/matters/new",
          bodyKind: "empty",
        });
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

test("React API client reports malformed success responses as API errors", async () => {
  const { api } = await importReactApiClient();
  const restoreFetch = mockFetch(async () => new Response("<html><head><title>Welcome</title></head><body>not json</body></html>", {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "text/html" },
  }));

  try {
    await assert.rejects(
      () => api.getMatters(),
      (error) => {
        assert.equal(error.statusCode, 200);
        assert.equal(error.code, "api.invalid_json_response");
        assert.match(error.message, /server returned an invalid response/i);
        assert.doesNotMatch(error.message, /<html|<head|not json/i);
        assert.deepEqual(error.diagnostic, {
          statusCode: 200,
          code: "api.invalid_json_response",
          statusText: "OK",
          urlPath: "/api/matters",
          bodyKind: "html",
          htmlTitle: "Welcome",
        });
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

async function importReactApiClient() {
  const secretRedactionUrl = await transpiledDataUrl(reactSecretRedactionPath);
  const workspaceLabelsUrl = await transpiledDataUrl(reactWorkspaceLabelsPath);
  const source = await readFile(apiClientPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  }).outputText
    .replace("from '../lib/secretRedaction';", `from '${secretRedactionUrl}';`)
    .replace("from '../lib/workspaceLabels';", `from '${workspaceLabelsUrl}';`);
  const dir = await mkdtemp(path.join(os.tmpdir(), "mwb-react-api-client-"));
  const modulePath = path.join(dir, "client.mjs");
  await writeFile(modulePath, compiled);
  try {
    return await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function transpiledDataUrl(fileUrl) {
  const source = await readFile(fileUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}

function mockFetch(fetchImpl) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return () => {
    globalThis.fetch = originalFetch;
  };
}
