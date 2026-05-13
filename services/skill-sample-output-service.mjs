import { randomUUID } from "node:crypto";
import { buildMatterContextPacket } from "./matter-context-service.mjs";
import { resolveProviderConfig } from "../shared/ai-provider-policy.mjs";
import { AI_PROVIDERS, AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";
import { extractResponsesOutputText } from "../shared/responses-client.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";

export const SKILL_SAMPLE_OUTPUT_SCHEMA_VERSION = "skill-sample-output/v1";

const SAMPLE_CONTEXT_LIMITS = Object.freeze({
  maxSources: 35,
  maxBlocks: 45,
  maxCharsPerBlock: 700,
  maxLibraryArtifacts: 4,
});

const MAX_FEEDBACK_LENGTH = 3000;
const MAX_PREVIOUS_SAMPLE_LENGTH = 12000;
const MAX_SAMPLE_LENGTH = 30000;

const SAMPLE_SYSTEM_PROMPT = [
  "You create sample outputs for proposed Legal Workbench skills.",
  "This is not skill generation. Do not produce code, prompts, schemas, configuration, or slash commands.",
  "Return Markdown only.",
  "Use the proposed skill request, design brief, and bounded matter context packet.",
  "The sample should look like the artifact the future skill would produce for the chosen test matter.",
  "If the output is internal legal review, preserve source labels plus raw FILE-NNNN pX.bY citations for factual points.",
  "If the output is client-facing or dispatch-facing, keep raw FILE citations internal unless the design brief explicitly asks to show them.",
  "Do not invent facts. Mark uncertainty and missing evidence clearly.",
  "Do not claim the skill is runnable or ready.",
].join(" ");

export function createSkillSampleOutputService({
  matterStore,
  sampleProvider,
  env = process.env,
  fetchImpl = fetch,
  endpoint,
  now = () => new Date(),
  idFactory = () => `sample_${randomUUID()}`,
} = {}) {
  if (!matterStore) throw new Error("matterStore is required");

  async function generateSampleOutput({
    idea = {},
    feedback = "",
    previousSample = "",
  } = {}) {
    const root = matterStore.getMatterRoot?.();
    if (!root) throw makeHttpError("Pick a test matter before generating sample output.", 409);
    const normalizedIdea = normalizeIdeaForSample(idea);
    const normalizedFeedback = boundedText(feedback, MAX_FEEDBACK_LENGTH, "feedback");
    const normalizedPreviousSample = boundedText(previousSample, MAX_PREVIOUS_SAMPLE_LENGTH, "previous sample");
    const packet = await buildMatterContextPacket(root, SAMPLE_CONTEXT_LIMITS);
    const policy = resolveModelPolicy(AI_TASKS.SKILL_SAMPLE_OUTPUT, { env });
    const providerConfig = resolveProviderConfig(policy, { endpoint });
    if (!providerConfig.model) throw makeHttpError("Skill sample output model is not configured.", 409);
    const provider = sampleProvider || createDefaultSkillSampleOutputProvider({
      providerConfig,
      env,
      fetchImpl,
    });
    const sampleMarkdown = normalizeSampleMarkdown(await provider({
      idea: normalizedIdea,
      feedback: normalizedFeedback,
      previousSample: normalizedPreviousSample,
      matterContext: summarizeMatterContextForSample(packet),
      providerConfig,
    }));

    return {
      schema_version: SKILL_SAMPLE_OUTPUT_SCHEMA_VERSION,
      sample_id: idFactory(),
      generated_at: now().toISOString(),
      matter: packet.matter || {},
      idea: normalizedIdea,
      feedback: normalizedFeedback,
      sample_markdown: sampleMarkdown,
      ai_run: {
        provider: providerConfig.provider,
        model: providerConfig.model,
        task: AI_TASKS.SKILL_SAMPLE_OUTPUT,
      },
      warnings: [
        "Sample output only. Creating a skill still requires approval and validation.",
        ...(Array.isArray(packet.warnings) ? packet.warnings.slice(0, 5) : []),
      ],
    };
  }

  return { generateSampleOutput };
}

export function createOpenAiSkillSampleOutputProvider({
  apiKey,
  endpoint,
  fetchImpl = fetch,
  model,
  maxOutputTokens,
  timeoutMs,
} = {}) {
  return async function openAiSkillSampleOutputProvider({
    idea,
    feedback,
    previousSample,
    matterContext,
  } = {}) {
    if (!apiKey) throw makeHttpError("OPENAI_API_KEY is required for skill sample output generation", 409);
    const body = {
      model,
      max_output_tokens: maxOutputTokens,
      input: [
        { role: "system", content: SAMPLE_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(sampleUserPayload({ idea, feedback, previousSample, matterContext })) },
      ],
    };
    const payload = await fetchJsonWithTimeout({
      fetchImpl,
      endpoint,
      apiKey,
      body,
      timeoutMs,
      timeoutMessage: `OpenAI skill sample output request timed out after ${timeoutMs}ms`,
    });
    const outputText = extractResponsesOutputText(payload);
    if (!outputText) throw makeHttpError("OpenAI skill sample output response did not include output text", 502);
    return outputText;
  };
}

export function createOpenRouterSkillSampleOutputProvider({
  apiKey,
  endpoint,
  fetchImpl = fetch,
  model,
  maxOutputTokens,
  timeoutMs,
  requireParameters = true,
  allowFallbacks = false,
} = {}) {
  return async function openRouterSkillSampleOutputProvider({
    idea,
    feedback,
    previousSample,
    matterContext,
  } = {}) {
    if (!apiKey) throw makeHttpError("OPENROUTER_API_KEY is required for skill sample output generation", 409);
    const body = {
      model,
      messages: [
        { role: "system", content: SAMPLE_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(sampleUserPayload({ idea, feedback, previousSample, matterContext })) },
      ],
      temperature: 0,
      max_tokens: maxOutputTokens,
      provider: {
        require_parameters: requireParameters,
        allow_fallbacks: allowFallbacks,
      },
    };
    const payload = await fetchJsonWithTimeout({
      fetchImpl,
      endpoint,
      apiKey,
      body,
      timeoutMs,
      extraHeaders: {
        "http-referer": "https://github.com/molotovsingh/matter-workbench",
        "x-title": "Matter Workbench Skill Sample Output",
      },
      timeoutMessage: `OpenRouter skill sample output request timed out after ${timeoutMs}ms`,
    });
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) return content;
    throw makeHttpError("OpenRouter skill sample output response did not include message content", 502);
  };
}

function createDefaultSkillSampleOutputProvider({ providerConfig, env, fetchImpl }) {
  if (providerConfig.provider === AI_PROVIDERS.OPENROUTER) {
    return createOpenRouterSkillSampleOutputProvider({
      apiKey: env.OPENROUTER_API_KEY,
      endpoint: providerConfig.endpoint,
      fetchImpl,
      model: providerConfig.model,
      maxOutputTokens: providerConfig.maxOutputTokens,
      timeoutMs: providerConfig.timeoutMs,
      requireParameters: providerConfig.requireParameters,
      allowFallbacks: providerConfig.allowFallbacks,
    });
  }
  return createOpenAiSkillSampleOutputProvider({
    apiKey: env.OPENAI_API_KEY,
    endpoint: providerConfig.endpoint,
    fetchImpl,
    model: providerConfig.model,
    maxOutputTokens: providerConfig.maxOutputTokens,
    timeoutMs: providerConfig.timeoutMs,
  });
}

function sampleUserPayload({ idea, feedback, previousSample, matterContext }) {
  return {
    task: "Generate a non-runnable sample output for user review.",
    strict_boundaries: [
      "Do not create or claim to create a skill.",
      "Do not produce a slash command.",
      "Do not produce prompt text, schema, code, or configuration.",
      "Do not write artifacts.",
      "Output Markdown only.",
    ],
    skill_request: idea,
    test_matter_context: matterContext,
    previous_sample: previousSample || "",
    feedback: feedback || "",
  };
}

function summarizeMatterContextForSample(packet) {
  const evidenceBlocks = Array.isArray(packet?.evidence_blocks) ? packet.evidence_blocks : [];
  const sources = Array.isArray(packet?.sources) ? packet.sources : [];
  return {
    schema_version: packet?.schema_version || "",
    matter: packet?.matter || {},
    counts: {
      sources: sources.length,
      evidence_blocks_included: evidenceBlocks.length,
      evidence_blocks_omitted: Number(packet?.limits?.omitted_blocks || 0),
      library_artifacts: Array.isArray(packet?.library_artifacts) ? packet.library_artifacts.length : 0,
    },
    sources: sources.slice(0, 20).map((source) => ({
      file_id: source.file_id || "",
      source_label: source.source_label || "",
      source_short_label: source.source_short_label || "",
      document_type: source.document_type || "",
      source_path: source.source_path || "",
      sample_citations: Array.isArray(source.sample_citations) ? source.sample_citations.slice(0, 3) : [],
    })),
    evidence_blocks: evidenceBlocks.slice(0, 45).map((block) => ({
      citation: block.citation || "",
      source_label: block.source_label || "",
      source_short_label: block.source_short_label || "",
      source_path: block.source_path || "",
      text: boundedText(block.text, 700, "evidence block text"),
    })),
    library_artifacts: (Array.isArray(packet?.library_artifacts) ? packet.library_artifacts : []).slice(0, 4).map((artifact) => ({
      path: artifact.path || "",
      kind: artifact.kind || "",
      summary: artifact.summary || artifact.heading || "",
      entry_count: artifact.entry_count ?? null,
      source_count: artifact.source_count ?? null,
    })),
    warnings: Array.isArray(packet?.warnings) ? packet.warnings.slice(0, 5) : [],
  };
}

function normalizeIdeaForSample(idea = {}) {
  const designBrief = idea.designBrief && typeof idea.designBrief === "object" ? idea.designBrief : {};
  const normalized = {
    id: normalizeText(idea.id),
    text: normalizeText(idea.text),
    status: normalizeText(idea.status),
    matter: {
      matterName: normalizeText(idea.matter?.matterName),
      folderName: normalizeText(idea.matter?.folderName),
    },
    designBrief: {
      intendedUser: normalizeText(designBrief.intendedUser),
      problem: normalizeText(designBrief.problem),
      expectedInputs: normalizeText(designBrief.expectedInputs),
      expectedOutputArtifact: normalizeText(designBrief.expectedOutputArtifact),
      targetLane: normalizeText(designBrief.targetLane),
      paidPosture: normalizeText(designBrief.paidPosture),
      riskLevel: normalizeText(designBrief.riskLevel),
      notes: normalizeText(designBrief.notes),
    },
  };
  if (!normalized.text) throw makeHttpError("Skill idea text is required for sample output.", 400);
  return normalized;
}

async function fetchJsonWithTimeout({
  fetchImpl,
  endpoint,
  apiKey,
  body,
  timeoutMs,
  extraHeaders = {},
  timeoutMessage,
}) {
  const { signal, cancelTimeout } = createRequestSignal(timeoutMs);
  let response;
  let payload;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    payload = await response.json().catch((error) => {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      return null;
    });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") {
      throw makeHttpError(timeoutMessage || `Provider request timed out after ${timeoutMs}ms`, 504);
    }
    throw error;
  } finally {
    cancelTimeout();
  }
  if (!response.ok || payload?.error) {
    const message = payload?.error?.message || `Provider returned ${response?.status || "an error"}`;
    throw makeHttpError(message, response?.status >= 400 && response.status < 500 ? 502 : 503);
  }
  return payload;
}

function createRequestSignal(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    return {
      signal: null,
      cancelTimeout: () => {},
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancelTimeout: () => clearTimeout(timer),
  };
}

function normalizeSampleMarkdown(value) {
  const markdown = String(value || "").trim();
  if (!markdown) throw makeHttpError("Skill sample output was blank.", 502);
  return markdown.length > MAX_SAMPLE_LENGTH ? markdown.slice(0, MAX_SAMPLE_LENGTH) : markdown;
}

function boundedText(value, maxLength, label) {
  const text = normalizeText(value);
  if (text.length > maxLength) return text.slice(0, maxLength);
  return text;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
