import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkbenchServer } from "../server.mjs";

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

async function postJson(baseUrl, pathName, body = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

async function withServer(options, fn) {
  const app = await createWorkbenchServer({
    host: "127.0.0.1",
    port: 0,
    skillRegistryPath: path.join(process.cwd(), "skills", "registry.json"),
    ...options,
  });
  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    await fn({ app, baseUrl });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

async function createBaselineMatter() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "unibox-baseline-"));
  const appDir = path.join(tmp, "app");
  const matterRoot = path.join(tmp, "matters", "Mehta Matter");
  const intakeDir = path.join(matterRoot, "00_Inbox", "Intake 01 - Initial");
  const extractedDir = path.join(intakeDir, "_extracted");

  await mkdir(appDir, { recursive: true });
  await mkdir(extractedDir, { recursive: true });
  await mkdir(path.join(matterRoot, "10_Library"), { recursive: true });

  await writeFile(path.join(matterRoot, "matter.json"), JSON.stringify({
    matter_name: "Mehta Matter",
    matter_type: "property",
    client_name: "Rajesh Mehta",
    opposite_party: "Skyline Builders",
    jurisdiction: "India",
    brief_description: "Delayed possession and flooring-specification dispute.",
  }, null, 2));

  await writeFile(
    path.join(intakeDir, "File Register.csv"),
    [
      "file_id,original_name,sha256,relative_path",
      "FILE-0001,notice.txt,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__notice.txt",
      "",
    ].join("\n"),
  );

  await writeFile(path.join(extractedDir, "FILE-0001.json"), JSON.stringify({
    schema_version: "extraction-record/v1",
    file_id: "FILE-0001",
    original_name: "notice.txt",
    source_path: "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__notice.txt",
    pages: [{
      page: 1,
      blocks: [
        {
          id: "p1.b1",
          type: "paragraph",
          text: "Skyline Builders promised possession by 31 December 2023 and delay compensation at SBI MCLR plus 2 percent.",
        },
        {
          id: "p1.b2",
          type: "paragraph",
          text: "The legal notice asks for possession with Italian marble or refund with interest and Rs. 5,00,000 compensation.",
        },
      ],
    }],
  }, null, 2));

  await writeFile(path.join(matterRoot, "10_Library", "List of Dates.json"), JSON.stringify({
    schema_version: "extraction-record/v1",
    file_id: "DATES-01",
    original_name: "List of Dates",
    pages: [{
      page: 1,
      blocks: [
        {
          id: "p1.b1",
          type: "paragraph",
          text: "2023-12-31: Skyline Builders possession deadline per agreement.",
        },
      ],
    }],
  }, null, 2));

  return { appDir, matterRoot };
}

function installFakeOpenAiResponses(t) {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    const urlString = String(url);
    if (urlString !== OPENAI_RESPONSES_ENDPOINT) {
      return originalFetch(url, options);
    }

    const body = JSON.parse(options.body || "{}");
    calls.push(body);
    const schemaName = body?.text?.format?.name;
    const output = buildFakeResponse(schemaName, body);

    return {
      ok: true,
      status: 200,
      json: async () => ({ output_text: JSON.stringify(output) }),
    };
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  return calls;
}

function buildFakeResponse(schemaName, body) {
  switch (schemaName) {
    case "intent_classification":
      return classifyFromFakeRequest(body);
    case "skill_router_decision":
      return routeFromFakeRequest(body);
    case "matter_qa_answer":
      return answerFromFakeRequest(body);
    default:
      throw new Error(`Unexpected fake OpenAI schema: ${schemaName || "none"}`);
  }
}

function classifyFromFakeRequest(body) {
  const userPayload = JSON.parse(body.input.at(-1).content);
  const message = userPayload.user_message.trim();
  const lower = message.toLowerCase();

  if (lower.startsWith("/")) {
    return {
      intent: "run_skill",
      matched_skill: message.split(/\s+/)[0],
      confidence: 1,
      reason: "Explicit slash command.",
    };
  }
  if (/^(?:find|search|look\s+for|locate|show\s+me)\s/i.test(lower)) {
    return {
      intent: "search",
      matched_skill: "",
      confidence: 0.94,
      reason: "The user is asking to locate text inside matter documents.",
    };
  }
  if (lower.includes("new skill") || lower.includes("modify skill")) {
    return {
      intent: "skill_request",
      matched_skill: "",
      confidence: 0.9,
      reason: "The user wants to change the toolset.",
    };
  }

  return {
    intent: "copilot_qa",
    matched_skill: "",
    confidence: 0.93,
    reason: "The user is asking a question about the current matter.",
  };
}

function routeFromFakeRequest(body) {
  const userPayload = JSON.parse(body.input.at(-1).content);
  const userRequest = String(userPayload.user_request || "");
  const slash = userRequest.trim().split(/\s+/)[0];
  const matchedSkill = slash.startsWith("/") ? slash : "/create_listofdates";

  return {
    decision: "run_existing_skill",
    recommended_action: "run_existing_skill",
    matched_skill: matchedSkill,
    confidence: 0.99,
    reason: `${matchedSkill} already covers this workflow.`,
    user_gate_required: false,
    suggested_next_action: `Run ${matchedSkill}.`,
    mece_violation: false,
    legal_setting: {
      jurisdiction: "",
      forum: "",
      case_type: "",
      procedure_stage: "",
      side: "",
      relief_type: "",
    },
    override_requires: [],
  };
}

function answerFromFakeRequest(body) {
  const userPayload = JSON.parse(body.input.at(-1).content);
  const question = String(userPayload.question || "").toLowerCase();

  if (question.includes("recheck") || question.includes("itemised")) {
    return {
      answer: [
        "| Item | Amount | Source |",
        "|---|---:|---|",
        "| Compensation demanded | Rs. 5,00,000 | FILE-0001 p1.b2 |",
        "| Delay basis | SBI MCLR + 2 percent | FILE-0001 p1.b1 |",
      ].join("\n"),
      sources: ["FILE-0001 p1.b1", "FILE-0001 p1.b2"],
      confidence: 0.88,
    };
  }
  if (question.includes("timeline") || question.includes("dates") || question.includes("deadline")) {
    return {
      answer: "The possession deadline was 31 December 2023 per the Skyline Builders agreement.",
      sources: ["DATES-01 p1.b1"],
      confidence: 0.92,
    };
  }

  return {
    answer: "Mehta can ask for possession with Italian marble or refund with interest, plus Rs. 5,00,000 compensation. FILE-0001 p1.b2",
    sources: ["FILE-0001 p1.b2"],
    confidence: 0.91,
  };
}

test("unibox API baseline covers greeting, search, slash routing, Q&A, and follow-up", async (t) => {
  const openAiCalls = installFakeOpenAiResponses(t);
  const { appDir, matterRoot } = await createBaselineMatter();

  await withServer({
    appDir,
    matterRoot,
    env: {
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "gpt-5.4-mini",
      OPENAI_MAX_OUTPUT_TOKENS: "3000",
      OPENAI_ROUTER_MAX_OUTPUT_TOKENS: "1200",
    },
  }, async ({ baseUrl }) => {
    const empty = await postJson(baseUrl, "/api/unibox", {});
    assert.equal(empty.status, 400);
    assert.equal(empty.payload.error, "userInput is required");

    const greeting = await postJson(baseUrl, "/api/unibox", { userInput: "hello" });
    assert.equal(greeting.ok, true);
    assert.equal(greeting.payload.intent, "greeting");
    assert.equal(greeting.payload.displayType, "chat_response");
    assert.match(greeting.payload.result.message, /Ask questions/);
    assert.equal(openAiCalls.length, 0, "greetings should stay local and not call AI");

    const directSearch = await postJson(baseUrl, "/api/unibox", { userInput: "Skyline" });
    assert.equal(directSearch.ok, true);
    assert.equal(directSearch.payload.intent, "copilot_qa");
    assert.equal(directSearch.payload.displayType, "qa_answer");

    const phrasedSearch = await postJson(baseUrl, "/api/unibox", { userInput: "find Skyline" });
    assert.equal(phrasedSearch.ok, true);
    assert.equal(phrasedSearch.payload.intent, "search");
    assert.equal(phrasedSearch.payload.displayType, "search_results");
    assert.equal(phrasedSearch.payload.result.query, "Skyline");
    assert.ok(phrasedSearch.payload.result.totalResults >= 1);
    assert.match(phrasedSearch.payload.result.results[0].snippet, /\*\*Skyline\*\*/);

    const searchNoFor = await postJson(baseUrl, "/api/unibox", { userInput: "search Skyline" });
    assert.equal(searchNoFor.ok, true);
    assert.equal(searchNoFor.payload.intent, "search");
    assert.equal(searchNoFor.payload.displayType, "search_results");
    assert.equal(searchNoFor.payload.result.query, "Skyline");

    const slash = await postJson(baseUrl, "/api/unibox", { userInput: "/extract" });
    assert.equal(slash.ok, true);
    assert.equal(slash.payload.intent, "run_skill");
    assert.equal(slash.payload.displayType, "skill_router");
    assert.equal(slash.payload.matchedSkill, "/extract");
    assert.equal(slash.payload.result.decision, "run_existing_skill");
    assert.equal(slash.payload.result.matched_skill, "/extract");

    const qa = await postJson(baseUrl, "/api/unibox", {
      userInput: "what should mehta ask as compensation or claim?",
    });
    assert.equal(qa.ok, true);
    assert.equal(qa.payload.intent, "copilot_qa");
    assert.equal(qa.payload.displayType, "qa_answer");
    assert.match(qa.payload.result.answer, /Rs\. 5,00,000 compensation/);
    assert.deepEqual(qa.payload.result.sources, ["FILE-0001 p1.b2"]);
    assert.equal(qa.payload.conversationHistory.length, 2);

    const followUp = await postJson(baseUrl, "/api/unibox", {
      userInput: "recheck the math and return a neat itemised table",
      conversationHistory: qa.payload.conversationHistory,
    });
    assert.equal(followUp.ok, true);
    assert.equal(followUp.payload.intent, "copilot_qa");
    assert.match(followUp.payload.result.answer, /\| Item \| Amount \| Source \|/);
    assert.deepEqual(followUp.payload.result.sources, ["FILE-0001 p1.b1", "FILE-0001 p1.b2"]);
    assert.equal(followUp.payload.conversationHistory.length, 4);

    const timelineQa = await postJson(baseUrl, "/api/unibox", {
      userInput: "what is the timeline of dates and deadlines?",
    });
    assert.equal(timelineQa.ok, true);
    assert.equal(timelineQa.payload.intent, "copilot_qa");
    assert.equal(timelineQa.payload.displayType, "qa_answer");
    assert.match(timelineQa.payload.result.answer, /31 December 2023/);
    assert.deepEqual(timelineQa.payload.result.sources, ["DATES-01 p1.b1"]);
  });
});

test("unibox returns local no-matter messaging without calling AI", async (t) => {
  const openAiCalls = installFakeOpenAiResponses(t);
  const appDir = await mkdtemp(path.join(os.tmpdir(), "unibox-no-matter-"));

  await withServer({
    appDir,
    env: {
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "gpt-5.4-mini",
      OPENAI_MAX_OUTPUT_TOKENS: "3000",
    },
  }, async ({ baseUrl }) => {
    const result = await postJson(baseUrl, "/api/unibox", {
      userInput: "what is this matter about?",
    });

    assert.equal(result.ok, true);
    assert.equal(result.payload.intent, "copilot_qa");
    assert.equal(result.payload.displayType, "error");
    assert.equal(result.payload.result.message, "Load a matter first before asking questions or searching.");
    assert.equal(openAiCalls.length, 0, "no-matter pre-check should block AI calls entirely");
  });
});

test("unibox serves local-only intents without a matter loaded", async (t) => {
  const openAiCalls = installFakeOpenAiResponses(t);
  const appDir = await mkdtemp(path.join(os.tmpdir(), "unibox-no-matter-local-"));

  await withServer({
    appDir,
    env: {
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "gpt-5.4-mini",
      OPENAI_MAX_OUTPUT_TOKENS: "3000",
    },
  }, async ({ baseUrl }) => {
    const greeting = await postJson(baseUrl, "/api/unibox", { userInput: "hello" });
    assert.equal(greeting.ok, true);
    assert.equal(greeting.payload.intent, "greeting");
    assert.equal(greeting.payload.displayType, "chat_response");
    assert.equal(openAiCalls.length, 0, "greeting with no matter should not call AI");

    const slash = await postJson(baseUrl, "/api/unibox", { userInput: "/extract" });
    assert.equal(slash.ok, true);
    assert.equal(slash.payload.intent, "run_skill");
    assert.equal(slash.payload.displayType, "skill_router");
    assert.ok(openAiCalls.length >= 1, "slash routing requires skill-router AI call");
  });
});
