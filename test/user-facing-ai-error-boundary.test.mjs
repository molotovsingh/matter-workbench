import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkbenchServer } from "../server.mjs";
import {
  containsUserFacingRestrictedAiLanguage,
  USER_FACING_ASSISTANT_UNAVAILABLE_CODE,
  USER_FACING_ASSISTANT_UNAVAILABLE_MESSAGE,
} from "../shared/user-facing-ai-language-policy.js";

function providerAccountError() {
  const error = new Error("User not found.");
  error.statusCode = 502;
  error.code = "provider.error";
  return error;
}

function runtimeMatter(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Boundary Matter",
    matterName: "Boundary Caption",
    matterPath: "postgres:Boundary Matter",
    ...overrides,
  };
}

function directPacket(matter = runtimeMatter()) {
  return {
    schema_version: "matter-context-packet/v1",
    generated_at: "2026-06-29T00:00:00.000Z",
    matter: { matter_name: matter.matterName, folder_name: matter.name },
    limits: { included_blocks: 1, omitted_blocks: 0 },
    sources: [{ file_id: "FILE-0001", source_label: "Agreement note", source_short_label: "Agreement note" }],
    evidence_blocks: [{ citation: "FILE-0001 p1.b1", source_label: "Agreement note", source_short_label: "Agreement note", text: "Agreement was signed." }],
    library_artifacts: [],
    warnings: [],
  };
}

async function startBoundaryServer(options = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-ai-error-boundary-"));
  const appDir = path.resolve(".");
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });
  const matter = runtimeMatter();
  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome, OPENAI_API_KEY: "sk-test" },
    host: "127.0.0.1",
    port: 0,
    configurableSkillsPath: path.join(tmp, "configurable-skills.json"),
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      listMatterFolders: async () => [matter],
      findMatterFolder: async (name) => (
        name === matter.name || name === matter.matterName ? matter : null
      ),
    },
    runtimeDbStorageService: {
      enabled: true,
      async readMatterContextPacket(foundMatter) {
        return directPacket(foundMatter);
      },
    },
    ...options,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  return {
    app,
    baseUrl: `http://127.0.0.1:${app.server.address().port}`,
    matter,
    async close() {
      await new Promise((resolve) => app.server.close(resolve));
    },
  };
}

async function postJsonRaw(baseUrl, pathname, body = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

test("Matter Copilot provider account failures are sanitized at the API boundary", async () => {
  const server = await startBoundaryServer({
    matterCopilotProvider: async () => {
      throw providerAccountError();
    },
  });
  try {
    const { response, payload } = await postJsonRaw(server.baseUrl, "/api/matter-copilot/answer", {
      matterName: server.matter.matterName,
      question: "What happened?",
    });

    assert.equal(response.status, 502);
    assert.equal(payload.error, USER_FACING_ASSISTANT_UNAVAILABLE_MESSAGE);
    assert.equal(payload.code, USER_FACING_ASSISTANT_UNAVAILABLE_CODE);
    assert.equal(containsUserFacingRestrictedAiLanguage(payload), false);
    assert.doesNotMatch(JSON.stringify(payload), /User not found|provider\.error|openrouter|openai/i);
  } finally {
    await server.close();
  }
});

test("Skill intent provider account failures are sanitized at the API boundary", async () => {
  const server = await startBoundaryServer({
    skillRouterProvider: async () => {
      throw providerAccountError();
    },
  });
  try {
    const { response, payload } = await postJsonRaw(server.baseUrl, "/api/skills/check-intent", {
      matterName: server.matter.matterName,
      userRequest: "What is this matter about?",
    });

    assert.equal(response.status, 502);
    assert.equal(payload.error, USER_FACING_ASSISTANT_UNAVAILABLE_MESSAGE);
    assert.equal(payload.code, USER_FACING_ASSISTANT_UNAVAILABLE_CODE);
    assert.equal(containsUserFacingRestrictedAiLanguage(payload), false);
    assert.doesNotMatch(JSON.stringify(payload), /User not found|provider\.error|openrouter|openai/i);
  } finally {
    await server.close();
  }
});
