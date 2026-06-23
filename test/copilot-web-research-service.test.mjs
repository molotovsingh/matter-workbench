import assert from "node:assert/strict";
import test from "node:test";
import {
  COPILOT_WEB_RESEARCH_ANSWER_SCHEMA_VERSION,
  createCopilotWebResearchService,
  readCopilotWebResearchConfig,
} from "../services/copilot-web-research-service.mjs";

const packet = Object.freeze({
  schema_version: "matter-context-packet/v1",
  matter: { matter_name: "Research Matter" },
  sources: [],
  evidence_blocks: [],
  library_artifacts: [],
});

test("copilot web research config is disabled by default", () => {
  assert.deepEqual(readCopilotWebResearchConfig({}), {
    enabled: false,
    provider: "exa",
    apiKeyEnvKey: "EXA_API_KEY",
    providerConfigured: false,
    maxResults: 6,
    timeoutMs: 20_000,
    maxResultChars: 9000,
  });
});

test("copilot web research availability requires flag, key, and answer provider", () => {
  const disabled = createCopilotWebResearchService({ env: {} });
  assert.equal(disabled.isEnabled(), false);
  assert.equal(disabled.readAvailability().featureEnabled, false);

  const missingProvider = createCopilotWebResearchService({
    env: { COPILOT_WEB_RESEARCH_ENABLED: "1", EXA_API_KEY: "exa-test" },
  });
  assert.equal(missingProvider.readAvailability().featureEnabled, true);
  assert.equal(missingProvider.readAvailability().providerConfigured, true);
  assert.equal(missingProvider.isEnabled(), false);

  const ready = createCopilotWebResearchService({
    env: { COPILOT_WEB_RESEARCH_ENABLED: "1", EXA_API_KEY: "exa-test" },
    webResearchProvider: async () => ({ sources: [{ id: "WEB-0001", title: "IBC" }] }),
    researchAnswerProvider: async () => ({ answer_status: "not_found" }),
  });
  assert.equal(ready.isEnabled(), true);
});

test("copilot web research fails disabled and unconfigured states with stable codes", async () => {
  await assert.rejects(
    () => createCopilotWebResearchService({ env: {} }).answerResearchQuestionFromPacket({
      packet,
      question: "Which NCLT sections apply?",
    }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "copilot_research.disabled");
      return true;
    },
  );

  await assert.rejects(
    () => createCopilotWebResearchService({ env: { COPILOT_WEB_RESEARCH_ENABLED: "1" } }).answerResearchQuestionFromPacket({
      packet,
      question: "Which NCLT sections apply?",
    }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "copilot_research.provider_not_configured");
      return true;
    },
  );
});

test("copilot web research normalizes fake answer provider output", async () => {
  const service = createCopilotWebResearchService({
    env: {
      COPILOT_WEB_RESEARCH_ENABLED: "true",
      EXA_API_KEY: "exa-test",
      COPILOT_WEB_RESEARCH_MAX_RESULTS: "4",
      COPILOT_WEB_RESEARCH_TIMEOUT_MS: "12345",
    },
    webResearchProvider: async () => ({
      query: "NCLT IBC",
      sources: [{
        id: "WEB-0001",
        title: "IBC",
        url: "https://example.test/ibc",
        sourceType: "official",
        publishedAt: "",
        snippet: "Section 60(5).",
      }],
    }),
    researchAnswerProvider: async ({ question, publicSources }) => ({
      answer_status: "answered",
      answer_markdown: `Research answer from public sources\n\n${question}`,
      public_sources: [{ id: publicSources[0].id, title: "Invented title should be ignored", url: "https://evil.test" }],
      ai_run: { task: "copilot_web_research" },
    }),
  });

  const answer = await service.answerResearchQuestionFromPacket({
    packet,
    question: " Which NCLT sections apply? ",
  });

  assert.equal(answer.schema_version, COPILOT_WEB_RESEARCH_ANSWER_SCHEMA_VERSION);
  assert.equal(answer.answer_status, "answered");
  assert.match(answer.answer_markdown, /Research answer from public sources/);
  assert.deepEqual(answer.public_sources, [{
    id: "WEB-0001",
    title: "IBC",
    url: "https://example.test/ibc",
    published_at: "",
    source_type: "official",
    snippet: "Section 60(5).",
  }]);
  assert.deepEqual(answer.research, { provider: "exa", query: "NCLT IBC", result_count: 1 });
});

test("copilot web research drops invented public source IDs", async () => {
  const service = createCopilotWebResearchService({
    env: { COPILOT_WEB_RESEARCH_ENABLED: "true", EXA_API_KEY: "exa-test" },
    webResearchProvider: async () => ({
      query: "NCLT IBC",
      sources: [{ id: "WEB-0001", title: "IBC", url: "https://example.test/ibc", sourceType: "official", snippet: "Section 60(5)." }],
    }),
    researchAnswerProvider: async () => ({
      answer_status: "answered",
      answer_markdown: "Research answer from public sources",
      public_sources: [{ id: "WEB-9999", title: "Made-up source", url: "https://made-up.test" }],
    }),
  });

  const answer = await service.answerResearchQuestionFromPacket({
    packet,
    question: "Which NCLT sections apply?",
  });

  assert.deepEqual(answer.public_sources, []);
  assert.match(answer.warnings.join("\n"), /Dropped unsupported public source WEB-9999/);
});
