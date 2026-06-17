import { randomUUID } from "node:crypto";
import { buildMatterContextPacket } from "./matter-context-service.mjs";
import { resolveProviderConfig } from "../shared/ai-provider-policy.mjs";
import {
  LEGAL_WORKBENCH_POLICY_PROMPT_VERSION,
} from "../shared/legal-workbench-policy-prompt.mjs";
import { AI_TASKS, resolveModelPolicy } from "../shared/model-policy.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import { createDefaultSkillSampleOutputProvider } from "./skill-sample-output-providers.mjs";

export {
  createOpenAiSkillSampleOutputProvider,
  createOpenRouterSkillSampleOutputProvider,
} from "./skill-sample-output-providers.mjs";

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
    matterRootOverride = "",
  } = {}) {
    const root = String(matterRootOverride || "").trim() || matterStore.getMatterRoot?.();
    if (!root) throw makeHttpError("Pick a test matter before generating sample output.", 409, "skill_sample_output.matter_required");
    const normalizedIdea = normalizeIdeaForSample(idea);
    const normalizedFeedback = boundedText(feedback, MAX_FEEDBACK_LENGTH, "feedback");
    const normalizedPreviousSample = boundedText(previousSample, MAX_PREVIOUS_SAMPLE_LENGTH, "previous sample");
    const packet = await buildMatterContextPacket(root, SAMPLE_CONTEXT_LIMITS);
    const policy = resolveModelPolicy(AI_TASKS.SKILL_SAMPLE_OUTPUT, { env });
    const providerConfig = resolveProviderConfig(policy, { endpoint });
    if (!providerConfig.model) throw makeHttpError("Skill sample output model is not configured.", 409, "skill_sample_output.model_not_configured");
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
        policyPromptVersion: LEGAL_WORKBENCH_POLICY_PROMPT_VERSION,
      },
      warnings: [
        "Sample output only. Creating a skill still requires approval and validation.",
        ...(Array.isArray(packet.warnings) ? packet.warnings.slice(0, 5) : []),
      ],
    };
  }

  return { generateSampleOutput };
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
  if (!normalized.text) throw makeHttpError("Skill idea text is required for sample output.", 400, "skill_sample_output.idea_text_required");
  return normalized;
}

function normalizeSampleMarkdown(value) {
  const markdown = String(value || "").trim();
  if (!markdown) throw makeHttpError("Skill sample output was blank.", 502, "skill_sample_output.blank_output");
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
