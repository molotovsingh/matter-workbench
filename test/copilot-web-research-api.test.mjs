import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkbenchServer } from "../server.mjs";

async function withServer(run, options = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-copilot-research-api-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  await mkdir(appDir, { recursive: true });
  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome, ...(options.env || {}) },
    host: "127.0.0.1",
    port: 0,
    skillRegistryPath: path.join(process.cwd(), "skills", "registry.json"),
    ...(options.serverOptions || {}),
  });
  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  try {
    await run({ app, baseUrl, mattersHome });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

async function postJsonRaw(baseUrl, pathName, body) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test("config exposes Copilot web research disabled by default", async () => {
  await withServer(async ({ baseUrl }) => {
    const config = await getJson(baseUrl, "/api/config");
    assert.equal(config.copilotWebResearchEnabled, false);
  });
});

test("research API returns stable disabled and provider configuration errors", async () => {
  await withServer(async ({ baseUrl }) => {
    const disabled = await postJsonRaw(baseUrl, "/api/matter-copilot/research", {
      question: "Which NCLT sections apply?",
      matterName: "Missing Matter",
    });
    assert.equal(disabled.response.status, 409);
    assert.equal(disabled.payload.code, "copilot_research.disabled");
    assert.match(disabled.payload.error, /Research is not enabled/);
  });

  await withServer(async ({ baseUrl }) => {
    const missingProvider = await postJsonRaw(baseUrl, "/api/matter-copilot/research", {
      question: "Which NCLT sections apply?",
      matterName: "Missing Matter",
    });
    assert.equal(missingProvider.response.status, 409);
    assert.equal(missingProvider.payload.code, "copilot_research.provider_not_configured");
    assert.match(missingProvider.payload.error, /Research is temporarily unavailable/);
  }, { env: { COPILOT_WEB_RESEARCH_ENABLED: "1" } });
});

test("config exposes research enabled only when the service is ready", async () => {
  await withServer(async ({ baseUrl }) => {
    const config = await getJson(baseUrl, "/api/config");
    assert.equal(config.copilotWebResearchEnabled, true);
  }, {
    env: { COPILOT_WEB_RESEARCH_ENABLED: "1", EXA_API_KEY: "exa-test" },
    serverOptions: {
      copilotWebResearchAnswerProvider: async () => ({ answer_status: "not_found" }),
    },
  });
});
