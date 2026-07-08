import { matterSummary } from "./entries.mjs";

export const TWO_PASS_ENGINE_VERSION = "create-listofdates-v2-two-pass";

export function mergeAiRunMetadata(baseAiRun, responseAiRuns) {
  const aiRuns = Array.isArray(responseAiRuns) ? responseAiRuns : [responseAiRuns].filter(Boolean);
  if (!aiRuns.length) return baseAiRun;
  const merged = { ...baseAiRun };
  const usage = {};
  for (const aiRun of aiRuns) {
    if (!aiRun || typeof aiRun !== "object" || Array.isArray(aiRun)) continue;
    if (aiRun.returnedModel) merged.returnedModel = aiRun.returnedModel;
    if (aiRun.returnedProvider) merged.returnedProvider = aiRun.returnedProvider;
    if (aiRun.usage) {
      addNumber(usage, "promptTokens", aiRun.usage.promptTokens);
      addNumber(usage, "completionTokens", aiRun.usage.completionTokens);
      addNumber(usage, "totalTokens", aiRun.usage.totalTokens);
      addNumber(usage, "cost", aiRun.usage.cost);
    }
  }
  if (Object.keys(usage).length) merged.usage = usage;
  return merged;
}

export function twoPassAiRunMetadata(pass1AiRun, pass2AiRun) {
  return {
    policyVersion: pass2AiRun.policyVersion || pass1AiRun.policyVersion,
    policyPromptVersion: pass2AiRun.policyPromptVersion || pass1AiRun.policyPromptVersion,
    task: "create_case_timeline_two_pass",
    tier: "source_backed_analysis",
    provider: "two-pass",
    model: `${pass1AiRun.model} -> ${pass2AiRun.model}`,
    fallback: "fail_closed",
    pass1: pass1AiRun,
    pass2: pass2AiRun,
  };
}

export function createCandidateLedger({
  matterJson,
  candidates,
  records,
  chronologyBlocks,
  filteredBlockCount,
  pass1AiRun,
  status,
}) {
  return {
    schema_version: "list-of-dates-candidates/v1",
    engine_version: TWO_PASS_ENGINE_VERSION,
    status,
    generated_at: new Date().toISOString(),
    matter: matterSummary(matterJson),
    source_record_count: records.length,
    source_block_count: chronologyBlocks.length,
    filtered_block_count: filteredBlockCount,
    ai_run: pass1AiRun,
    candidates,
  };
}

function addNumber(target, key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  target[key] = (target[key] || 0) + number;
}
