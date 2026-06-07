import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkbenchServer } from "../server.mjs";

function postJsonWithHttp({ port, pathName, body }) {
  return new Promise((resolve, reject) => {
    const text = JSON.stringify(body);
    const req = request({
      hostname: "127.0.0.1",
      port,
      path: pathName,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(text),
      },
    }, (res) => {
      let responseText = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        responseText += chunk;
      });
      res.on("end", () => {
        try {
          resolve({
            statusCode: res.statusCode,
            payload: responseText ? JSON.parse(responseText) : null,
            text: responseText,
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.end(text);
  });
}

test("AI settings API redacts submitted API keys from error payloads", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-ai-settings-api-"));
  const appDir = path.join(tmp, "app");
  await mkdir(appDir, { recursive: true });
  const submittedKey = "sk-or-v1-api-secret";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error(`proxy failure included Authorization: Bearer ${submittedKey}`);
  };

  const app = await createWorkbenchServer({
    appDir,
    env: {},
    host: "127.0.0.1",
    port: 0,
  });
  globalThis.fetch = originalFetch;

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await postJsonWithHttp({
      port: app.server.address().port,
      pathName: "/api/ai-settings",
      body: {
        copilotProvider: "openrouter",
        copilotModel: "google/gemini-2.5-pro",
        copilotApiKey: submittedKey,
      },
    });

    assert.equal(response.statusCode, 503);
    assert.match(response.payload.error, /redacted-secret/);
    assert.doesNotMatch(response.text, new RegExp(submittedKey));
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});
