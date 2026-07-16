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

  const sidecarReady = createCopilotWebResearchService({
    env: {
      COPILOT_WEB_RESEARCH_ENABLED: "1",
      COPILOT_WEB_RESEARCH_PROVIDER: "legal_source_sidecar",
      COPILOT_LEGAL_SOURCE_SERVICE_URL: "http://127.0.0.1:8790",
    },
    webResearchProvider: async () => ({ sources: [{ id: "STATUTE-0001", title: "Section 60, IBC" }] }),
    researchAnswerProvider: async () => ({ answer_status: "not_found" }),
  });
  assert.equal(sidecarReady.readAvailability().provider, "legal_source_sidecar");
  assert.equal(sidecarReady.readAvailability().providerConfigured, true);
  assert.equal(sidecarReady.isEnabled(), true);
});

test("copilot web research sidecar config works without EXA and unknown providers fail closed", () => {
  assert.deepEqual(readCopilotWebResearchConfig({
    COPILOT_WEB_RESEARCH_ENABLED: "1",
    COPILOT_WEB_RESEARCH_PROVIDER: "legal_source_sidecar",
    COPILOT_LEGAL_SOURCE_SERVICE_URL: "http://127.0.0.1:8790",
  }), {
    enabled: true,
    provider: "legal_source_sidecar",
    apiKeyEnvKey: "",
    providerConfigured: true,
    maxResults: 6,
    timeoutMs: 20_000,
    maxResultChars: 9000,
  });

  const unknown = createCopilotWebResearchService({
    env: {
      COPILOT_WEB_RESEARCH_ENABLED: "1",
      COPILOT_WEB_RESEARCH_PROVIDER: "bogus",
      EXA_API_KEY: "exa-test",
    },
    researchAnswerProvider: async () => ({ answer_status: "not_found" }),
  });
  assert.equal(unknown.readAvailability().provider, "bogus");
  assert.equal(unknown.readAvailability().providerConfigured, false);
  assert.equal(unknown.isEnabled(), false);
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

test("copilot web research validates matter citations against the context packet", async () => {
  const citedPacket = {
    ...packet,
    evidence_blocks: [{
      citation: "FILE-0001 p1.b1",
      source_label: "Agreement",
      source_short_label: "Agreement",
      text: "The agreement requires payment on 1 January.",
    }],
  };
  const answers = [
    {
      answer_status: "answered",
      answer_markdown: "The agreement fixes payment on 1 January [FILE-0001 p1.b1].",
      matter_sources: [
        { raw_citation: "FILE-0001 p1.b1", source_label: "Invented label", snippet: "Invented snippet" },
        { raw_citation: "FILE-9999 p9.b9", source_label: "Invented source", snippet: "Invented evidence" },
      ],
      public_sources: [{ id: "WEB-0001" }],
    },
    {
      answer_status: "answered",
      answer_markdown: "An unsupported matter record says otherwise [FILE-9999 p9.b9].",
      matter_sources: [],
      public_sources: [{ id: "WEB-0001" }],
    },
  ];
  const service = createCopilotWebResearchService({
    env: { COPILOT_WEB_RESEARCH_ENABLED: "true", EXA_API_KEY: "exa-test" },
    webResearchProvider: async () => ({
      sources: [{ id: "WEB-0001", title: "Public authority", url: "https://example.test/authority" }],
    }),
    researchAnswerProvider: async () => answers.shift(),
  });

  const partial = await service.answerResearchQuestionFromPacket({ packet: citedPacket, question: "When is payment due?" });
  assert.equal(partial.answer_status, "partial");
  assert.deepEqual(partial.matter_sources, [{
    raw_citation: "FILE-0001 p1.b1",
    source_label: "Invented label",
    snippet: "Invented snippet",
  }]);
  assert.match(partial.warnings.join("\n"), /matter source references could not be verified/i);

  const blocked = await service.answerResearchQuestionFromPacket({ packet: citedPacket, question: "What does the record say?" });
  assert.equal(blocked.answer_status, "blocked");
  assert.deepEqual(blocked.matter_sources, []);
  assert.doesNotMatch(blocked.answer_markdown, /FILE-9999/);
  assert.match(blocked.warnings.join("\n"), /withheld.*matter citation/i);
});

test("copilot web research validates public source IDs in structured output and prose", async () => {
  const service = createCopilotWebResearchService({
    env: { COPILOT_WEB_RESEARCH_ENABLED: "true", EXA_API_KEY: "exa-test" },
    webResearchProvider: async () => ({
      query: "NCLT IBC",
      sources: [
        { id: "WEB-0001", title: "IBC", url: "https://example.test/ibc", sourceType: "official", snippet: "Section 60(5)." },
        { id: "WEB-0002", title: "NCLT", url: "https://example.test/nclt", sourceType: "court", snippet: "NCLT direction." },
        {
          id: "STATUTE-0001",
          title: "Section 60, IBC",
          url: "https://example.test/statute",
          sourceType: "official_statute",
          snippet: "NCLT jurisdiction.",
          metadata: {
            provider: "statutes",
            slug: "insolvency-and-bankruptcy-code-2016",
            section: "60",
            act: "Insolvency and Bankruptcy Code, 2016",
            corpus_fingerprint: "corpus-sha256:test-fingerprint",
            built_at: "2026-07-08T02:29:12.998Z",
            provenance: {
              source: { name: "India Code", tier: "official", url: "https://indiacode.nic.in", retrieved_at: "2026-07-01" },
              authenticity_anchor: { status: "archived", archive_url: "https://archive.example.test" },
            },
          },
        },
      ],
      warnings: ["Statutes service used stored corpus; verify currency. token=sidecar-secret"],
    }),
    researchAnswerProvider: async () => ({
      answer_status: "answered",
      answer_markdown: "Research answer from public sources. See WEB-0002, STATUTE-0001, WEB-9999, and STATUTE-9999.",
      public_sources: [{ id: "WEB-9999", title: "Made-up source", url: "https://made-up.test" }],
    }),
  });

  const answer = await service.answerResearchQuestionFromPacket({
    packet,
    question: "Which NCLT sections apply?",
  });

  assert.deepEqual(answer.public_sources.map((source) => source.id), ["WEB-0002", "STATUTE-0001"]);
  assert.equal(answer.public_sources[1].source_type, "official_statute");
  assert.deepEqual(answer.public_sources[1].metadata, {
    provider: "statutes",
    slug: "insolvency-and-bankruptcy-code-2016",
    section: "60",
    act: "Insolvency and Bankruptcy Code, 2016",
    corpus_fingerprint: "corpus-sha256:test-fingerprint",
    built_at: "2026-07-08T02:29:12.998Z",
    provenance: {
      source: { name: "India Code", tier: "official", url: "https://indiacode.nic.in", retrieved_at: "2026-07-01" },
      authenticity_anchor: { status: "archived", archive_url: "https://archive.example.test" },
    },
  });
  assert.deepEqual(answer.research.corpus_fingerprints, ["corpus-sha256:test-fingerprint"]);
  assert.match(answer.warnings.join("\n"), /Dropped unsupported public source WEB-9999/);
  assert.match(answer.warnings.join("\n"), /Dropped unsupported public source STATUTE-9999/);
  assert.match(answer.warnings.join("\n"), /Statutes service used stored corpus/);
  assert.match(answer.warnings.join("\n"), /token=\[redacted-secret\]/);
  assert.doesNotMatch(answer.warnings.join("\n"), /sidecar-secret/);
});
