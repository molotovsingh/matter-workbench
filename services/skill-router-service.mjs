import { resolveProviderConfig } from "../shared/ai-provider-policy.mjs";
import {
  AI_TASKS,
  resolveModelPolicy,
} from "../shared/model-policy.mjs";
import { createOpenAiSkillRouterProvider } from "./skill-router-providers.mjs";

export { createOpenAiSkillRouterProvider } from "./skill-router-providers.mjs";

const DIRECT_OVERLAP_CONFIDENCE = 0.78;
const VALID_DECISIONS = new Set([
  "transient_copilot",
  "run_existing_skill",
  "modify_existing_skill",
  "create_or_modify_tuning",
  "adjacent_skill",
  "new_skill",
  "needs_user_approval",
  "override_requested",
]);
const VALID_RECOMMENDATIONS = new Set([...VALID_DECISIONS, "none"]);
const ROUTER_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "decision",
    "recommended_action",
    "matched_skill",
    "confidence",
    "reason",
    "user_gate_required",
    "suggested_next_action",
    "mece_violation",
    "legal_setting",
    "override_requires",
  ],
  properties: {
    decision: {
      type: "string",
      enum: [...VALID_DECISIONS],
    },
    recommended_action: {
      type: "string",
      enum: [...VALID_RECOMMENDATIONS],
    },
    matched_skill: {
      type: "string",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    reason: {
      type: "string",
    },
    user_gate_required: {
      type: "boolean",
    },
    suggested_next_action: {
      type: "string",
    },
    mece_violation: {
      type: "boolean",
    },
    legal_setting: {
      type: "object",
      additionalProperties: false,
      required: [
        "jurisdiction",
        "forum",
        "case_type",
        "procedure_stage",
        "side",
        "relief_type",
      ],
      properties: {
        jurisdiction: { type: "string" },
        forum: { type: "string" },
        case_type: { type: "string" },
        procedure_stage: { type: "string" },
        side: { type: "string" },
        relief_type: { type: "string" },
      },
    },
    override_requires: {
      type: "array",
      items: {
        type: "string",
      },
    },
  },
};

export function createSkillRouterService({
  registryService,
  aiProvider,
  env = process.env,
  endpoint,
} = {}) {
  if (!registryService) throw new Error("registryService is required");

  async function checkIntent({ userRequest, overrideJustification = "" } = {}) {
    const requestText = typeof userRequest === "string" ? userRequest.trim() : "";
    if (!requestText) {
      const error = new Error("userRequest is required");
      error.statusCode = 400;
      throw error;
    }

    const registry = await registryService.readRegistry();
    const modelPolicy = resolveModelPolicy(AI_TASKS.SKILL_ROUTER, { env });
    const providerConfig = resolveProviderConfig(modelPolicy, { endpoint });
    const provider = aiProvider || createOpenAiSkillRouterProvider({
      apiKey: env.OPENAI_API_KEY,
      model: providerConfig.model,
      endpoint: providerConfig.endpoint,
      maxOutputTokens: providerConfig.maxOutputTokens,
    });

    const rawDecision = await provider({
      userRequest: requestText,
      overrideJustification: String(overrideJustification || "").trim(),
      registry,
      schema: ROUTER_OUTPUT_SCHEMA,
    });

    return normalizeRouterDecision(rawDecision, registry, { userRequest: requestText });
  }

  return {
    checkIntent,
  };
}

export function normalizeRouterDecision(rawDecision, registry, context = {}) {
  const skillsBySlash = new Map((registry.skills || []).map((skill) => [skill.slash, skill]));
  const raw = rawDecision && typeof rawDecision === "object" ? rawDecision : {};
  const rawDecisionName = VALID_DECISIONS.has(raw.decision) ? raw.decision : "needs_user_approval";
  const matchedSkill = skillsBySlash.has(raw.matched_skill) ? raw.matched_skill : "";
  const confidence = clamp01(raw.confidence);
  const meceViolation = Boolean(raw.mece_violation && matchedSkill);
  const createIntent = hasCreateIntent(context.userRequest || "");
  const directOverlap = matchedSkill
    && (rawDecisionName === "modify_existing_skill" || (createIntent && rawDecisionName === "run_existing_skill"))
    && confidence >= DIRECT_OVERLAP_CONFIDENCE;

  let decision = rawDecisionName;
  let recommendedAction = VALID_RECOMMENDATIONS.has(raw.recommended_action)
    ? raw.recommended_action
    : "none";
  let userGateRequired = Boolean(raw.user_gate_required);
  let reason = collapseWhitespace(raw.reason || "No router reason provided.");

  if (
    (decision === "new_skill" || decision === "adjacent_skill")
    && looksLikeOneTimeMatterTask(context.userRequest || "")
  ) {
    decision = "transient_copilot";
    recommendedAction = "transient_copilot";
    userGateRequired = false;
    reason = collapseWhitespace(
      `The request looks like a one-time matter task, not a reusable skill. ${reason}`,
    );
  }

  if (meceViolation || directOverlap) {
    decision = "needs_user_approval";
    recommendedAction = rawDecisionName === "run_existing_skill" ? "run_existing_skill" : "modify_existing_skill";
    userGateRequired = true;
    reason = collapseWhitespace(
      `The request overlaps with ${matchedSkill}. User approval is required before rerouting or overriding. ${reason}`,
    );
  }

  if (decision === "override_requested") {
    userGateRequired = true;
  }

  if (decision === "transient_copilot") {
    recommendedAction = recommendedAction === "none" ? "transient_copilot" : recommendedAction;
    userGateRequired = false;
  }

  return {
    decision,
    recommended_action: recommendedAction,
    matched_skill: matchedSkill,
    matched_skill_card: matchedSkill ? skillsBySlash.get(matchedSkill) : null,
    confidence,
    reason,
    user_gate_required: userGateRequired,
    user_gate_choices: userGateRequired ? ["Use or improve existing skill", "Create separate skill with reason"] : [],
    suggested_next_action: collapseWhitespace(raw.suggested_next_action || ""),
    mece_violation: Boolean(meceViolation || directOverlap),
    legal_setting: normalizeLegalSetting(raw.legal_setting),
    override_requires: Array.isArray(raw.override_requires)
      ? raw.override_requires.map((item) => collapseWhitespace(item)).filter(Boolean)
      : [],
  };
}

function normalizeLegalSetting(value = {}) {
  return {
    jurisdiction: collapseWhitespace(value.jurisdiction || ""),
    forum: collapseWhitespace(value.forum || ""),
    case_type: collapseWhitespace(value.case_type || ""),
    procedure_stage: collapseWhitespace(value.procedure_stage || ""),
    side: collapseWhitespace(value.side || ""),
    relief_type: collapseWhitespace(value.relief_type || ""),
  };
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasCreateIntent(value) {
  return /\b(add|build|create|make|new|scaffold)\b/i.test(String(value || ""))
    && /\b(skill|workflow|slash command|slash skill)\b/i.test(String(value || ""));
}

function looksLikeOneTimeMatterTask(value) {
  const text = collapseWhitespace(value).toLowerCase();
  if (!text) return false;
  const durableSignal = /\b(reusable|repeatable|future|every|all matters|all cases|across matters|cross-matter|workflow|slash command|template|standard skill)\b/.test(text)
    || /\bfor\s+(?:future|all|every|similar|these)\s+(?:matters|cases)\b/.test(text);
  if (durableSignal) return false;

  const matterScoped = /\b(this|current|active|selected)\s+(matter|case|file|document|record)\b/.test(text)
    || /\bin\s+this\s+(matter|case|file|document|record)\b/.test(text)
    || /\bfor\s+this\s+(matter|case|file|document|record)\b/.test(text);
  const lookupTask = /\b(where is|where can i|find where|locate|show me|which document|what document|find the|find an|find a)\b/.test(text);
  const quickTask = /\b(one[- ]?time|quick|just|for now|ad hoc|temporary)\b/.test(text);

  return (matterScoped && lookupTask) || (matterScoped && quickTask);
}
