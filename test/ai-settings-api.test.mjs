import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkbenchServer } from "../server.mjs";
import { hashPrivateBetaPassword } from "../services/private-beta-auth-service.mjs";

function requestJsonWithHttp({ port, pathName, method = "GET", body, cookie = "" }) {
  return new Promise((resolve, reject) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const req = request({
      hostname: "127.0.0.1",
      port,
      path: pathName,
      method,
      headers: {
        ...(text ? {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(text),
        } : {}),
        ...(cookie ? { cookie } : {}),
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
            headers: res.headers,
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.end(text || undefined);
  });
}

function postJsonWithHttp(options) {
  return requestJsonWithHttp({ ...options, method: "POST" });
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

test("tester accounts can read Copilot status but cannot mutate shared AI settings", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-ai-settings-access-"));
  const appDir = path.join(tmp, "app");
  const usersFile = path.join(tmp, "private-beta-users.json");
  await mkdir(appDir, { recursive: true });
  await writeFile(usersFile, `${JSON.stringify({
    schemaVersion: "private-beta-users/v1",
    users: [{
      username: "tester@example.test",
      role: "tester",
      status: "active",
      passwordHash: hashPrivateBetaPassword("tester-secret", { salt: "tester-salt", iterations: 1_000 }),
    }],
  }, null, 2)}\n`, "utf8");

  const app = await createWorkbenchServer({
    appDir,
    env: {
      MWB_PRIVATE_BETA_AUTH: "required",
      MWB_PRIVATE_BETA_USERS_FILE: usersFile,
    },
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const port = app.server.address().port;
    const login = await postJsonWithHttp({
      port,
      pathName: "/api/auth/login",
      body: { username: "tester@example.test", password: "tester-secret" },
    });
    assert.equal(login.statusCode, 200);
    const cookie = String(login.headers?.["set-cookie"]?.[0] || "").split(";")[0];
    assert.ok(cookie);

    const readResponse = await requestJsonWithHttp({ port, pathName: "/api/ai-settings", cookie });
    assert.equal(readResponse.statusCode, 200);
    assert.equal(Object.hasOwn(readResponse.payload, "envPath"), false);

    const saveResponse = await postJsonWithHttp({
      port,
      pathName: "/api/ai-settings",
      cookie,
      body: { copilotProvider: "openrouter", copilotModel: "google/gemini-2.5-pro" },
    });
    assert.equal(saveResponse.statusCode, 403);
    assert.match(saveResponse.payload.error, /superuser/i);

    const testResponse = await postJsonWithHttp({
      port,
      pathName: "/api/ai-settings/test",
      cookie,
      body: {},
    });
    assert.equal(testResponse.statusCode, 403);
    assert.match(testResponse.payload.error, /superuser/i);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});
