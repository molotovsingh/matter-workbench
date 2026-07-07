import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
    assert.equal(missingProvider.payload.code, "assistant.unavailable");
    assert.match(missingProvider.payload.error, /Assistant is temporarily unavailable/);
    assert.doesNotMatch(JSON.stringify(missingProvider.payload), /provider|openrouter|openai|model|quota|billing/i);
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
      copilotWebResearchProvider: async () => ({ sources: [{ id: "WEB-0001", title: "IBC" }] }),
    },
  });
});

test("research API supports legal source sidecar provider with STATUTE sources", async () => {
  await withServer(async ({ baseUrl, mattersHome }) => {
    const config = await getJson(baseUrl, "/api/config");
    assert.equal(config.copilotWebResearchEnabled, true);

    const matterRoot = path.join(mattersHome, "Research Matter");
    await mkdir(matterRoot, { recursive: true });
    await writeFile(path.join(matterRoot, "matter.json"), JSON.stringify({ matter_name: "Research Matter" }, null, 2));
    const result = await postJsonRaw(baseUrl, "/api/matter-copilot/research", {
      question: "What does section 60 IBC say?",
      matterName: "Research Matter",
    });

    assert.equal(result.response.status, 200);
    assert.equal(result.payload.research.provider, "legal_source_sidecar");
    assert.deepEqual(result.payload.public_sources.map((source) => source.id), ["STATUTE-0001"]);
    assert.equal(result.payload.public_sources[0].source_type, "official_statute");
    assert.match(result.payload.warnings.join("\n"), /Stored corpus; verify currency/);
  }, {
    env: {
      COPILOT_WEB_RESEARCH_ENABLED: "1",
      COPILOT_WEB_RESEARCH_PROVIDER: "legal_source_sidecar",
      COPILOT_LEGAL_SOURCE_SERVICE_URL: "http://127.0.0.1:8790",
    },
    serverOptions: {
      copilotWebResearchAnswerProvider: async ({ publicSources }) => ({
        answer_status: "answered",
        answer_markdown: "Research answer from public sources. See STATUTE-0001.\n\n_Verify authorities before relying or filing._",
        public_sources: [{ id: publicSources[0].id }],
      }),
      copilotWebResearchProvider: async () => ({
        query: "section 60 IBC",
        sources: [{ id: "STATUTE-0001", title: "Section 60, IBC", sourceType: "official_statute", snippet: "NCLT jurisdiction." }],
        warnings: ["Stored corpus; verify currency."],
      }),
    },
  });
});

test("research API can return a fake research answer and capture route signal", async () => {
  const capturedSignals = [];
  await withServer(async ({ baseUrl, mattersHome }) => {
    const matterRoot = path.join(mattersHome, "Research Matter");
    await mkdir(matterRoot, { recursive: true });
    await writeFile(path.join(matterRoot, "matter.json"), JSON.stringify({ matter_name: "Research Matter" }, null, 2));
    const result = await postJsonRaw(baseUrl, "/api/matter-copilot/research", {
      question: "Which NCLT sections apply?",
      matterName: "Research Matter",
    });

    assert.equal(result.response.status, 200);
    assert.equal(result.payload.schema_version, "matter-copilot-research-answer/v1");
    assert.equal(result.payload.answer_status, "answered");
    assert.deepEqual(result.payload.public_sources.map((source) => source.id), ["WEB-0001"]);
    assert.equal(capturedSignals.length, 1);
    assert.equal(capturedSignals[0].event.code, "copilot_research.answer_returned");
    assert.equal(capturedSignals[0].event.category, "copilot_research");
    assert.equal(capturedSignals[0].event.view, "api");
    assert.equal(capturedSignals[0].event.fileCount, 1);
    assert.equal(capturedSignals[0].event.matterName, "Research Matter");
    assert.equal(capturedSignals[0].context.runtimeMode, "filesystem");
  }, {
    env: { COPILOT_WEB_RESEARCH_ENABLED: "1", EXA_API_KEY: "exa-test" },
    serverOptions: {
      privateBetaSignalService: {
        captureClientEvent: async (event, context) => {
          capturedSignals.push({ event, context });
          return { captured: 1, sent: 0, queued: 1, skipped: 0, failed: 0, signals: [] };
        },
      },
      copilotWebResearchAnswerProvider: async ({ publicSources }) => ({
        answer_status: "answered",
        answer_markdown: "Research answer from public sources\n\n_Verify authorities before relying or filing._",
        public_sources: [{ id: publicSources[0].id }],
      }),
      copilotWebResearchProvider: async () => ({
        query: "NCLT IBC",
        sources: [{ id: "WEB-0001", title: "IBC", url: "https://example.test/ibc", sourceType: "official", snippet: "Section 60(5)." }],
      }),
    },
  });
});
