import { legalWorkbenchSystemPrompt } from "../shared/legal-workbench-policy-prompt.mjs";
import { AI_PROVIDERS } from "../shared/model-policy.mjs";
import {
  fetchProviderJsonWithTimeout,
  parseOpenAiJsonOutput,
  parseOpenRouterJsonMessage,
} from "../shared/provider-http.mjs";

const SKILL_INTERVIEW_SYSTEM_PROMPT = legalWorkbenchSystemPrompt([
  "You plan short design interviews for future Legal Workbench skills.",
  "Return only strict JSON matching the supplied schema.",
  "Your job is to understand the exact skill idea and ask the lawyer-readable follow-up questions actually needed.",
  "Ask only the questions that are genuinely useful.",
  "You may ask up to about ten questions when the skill idea needs more design work.",
  "If the user's request is already detailed, ask fewer questions.",
  "If the user already supplied a detailed step-by-step skill specification, return zero questions and move it toward sample review.",
  "If more than ten questions would be useful, put the remaining topics in open_questions instead of asking them now.",
  "You may infer safe defaults, target lane, output artifact, risk flags, and design brief fields.",
  "You must not generate runnable skill code, prompts, schemas, provider runtime config, legal conclusions, or final legal advice.",
  "Use only these target lanes: 10_Library, 20_Workshop, 30_Drafts, 40_Dispatch.",
  "The expectedOutputArtifact must be a markdown path inside the target lane.",
  "External-facing or client-facing drafting belongs in 30_Drafts and should usually be high risk.",
  "For client update emails, prefer 30_Drafts/Client Update Email.md and keep raw FILE citations internal by default.",
  "Legal review, strategy, limitation, weakness, evidence-gap, and pleading-analysis ideas belong in 20_Workshop, not 30_Drafts, unless the user explicitly asks for an external draft.",
  "For formal party names, officers, signatories, aliases, or party-identity mapping, prefer 20_Workshop/Party and Officer Map.md and keep it source-backed.",
  "When a lawyer says limitation, assume statutory limitation/time-bar review unless the user specifically says limitation clause.",
  "For limitation review, prefer 20_Workshop/Limitation Review.md and ask about whose position, output decision shape, and applicable legal setting/statute/forum.",
  "For weakness review from the client's perspective, prefer 20_Workshop/Weakness Review.md and ask about weakness focus, output structure, and audience.",
  "If source discipline matters, include it as a default assumption unless it truly needs a user choice.",
  "For external-facing drafting, ask about audience, tone, and whether legal assessment should be included.",
  "For adjacent skill improvements, ask what changes and what must stay unchanged.",
], {
  customSkill: true,
});

export function createDefaultSkillInterviewPlannerProvider({ providerConfig, env, fetchImpl }) {
  if (providerConfig.provider === AI_PROVIDERS.OPENROUTER) {
    return createOpenRouterSkillInterviewPlannerProvider({
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
  return createOpenAiSkillInterviewPlannerProvider({
    apiKey: env.OPENAI_API_KEY,
    endpoint: providerConfig.endpoint,
    fetchImpl,
    model: providerConfig.model,
    maxOutputTokens: providerConfig.maxOutputTokens,
    timeoutMs: providerConfig.timeoutMs,
  });
}

export function createOpenAiSkillInterviewPlannerProvider({
  apiKey,
  endpoint,
  fetchImpl = fetch,
  model,
  maxOutputTokens,
  timeoutMs,
} = {}) {
  return async function openAiSkillInterviewPlannerProvider({
    userRequest,
    skillIdea,
    activeMatter,
    skillRegistry,
    designBrief,
    schema,
  } = {}) {
    if (!apiKey) {
      const error = new Error("OPENAI_API_KEY is required for skill interview planning");
      error.statusCode = 409;
      throw error;
    }
    const body = {
      model,
      max_output_tokens: maxOutputTokens,
      input: [
        {
          role: "system",
          content: SKILL_INTERVIEW_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: JSON.stringify(plannerUserPayload({
            userRequest,
            skillIdea,
            activeMatter,
            skillRegistry,
            designBrief,
          })),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "skill_interview_plan",
          strict: true,
          schema,
        },
      },
    };

    const payload = await fetchProviderJsonWithTimeout({
      fetchImpl,
      endpoint,
      apiKey,
      body,
      timeoutMs,
      timeoutMessage: `OpenAI skill interview planner request timed out after ${timeoutMs}ms`,
      mapProviderError: mapOpenAiPlannerError,
    });
    return parseOpenAiJsonOutput(payload, "OpenAI skill interview planner");
  };
}

export function createOpenRouterSkillInterviewPlannerProvider({
  apiKey,
  endpoint,
  fetchImpl = fetch,
  model,
  maxOutputTokens,
  timeoutMs,
  requireParameters = true,
  allowFallbacks = false,
} = {}) {
  return async function openRouterSkillInterviewPlannerProvider({
    userRequest,
    skillIdea,
    activeMatter,
    skillRegistry,
    designBrief,
    schema,
  } = {}) {
    if (!apiKey) {
      const error = new Error("OPENROUTER_API_KEY is required for skill interview planning");
      error.statusCode = 409;
      throw error;
    }
    const body = {
      model,
      messages: [
        {
          role: "system",
          content: SKILL_INTERVIEW_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: JSON.stringify(plannerUserPayload({
            userRequest,
            skillIdea,
            activeMatter,
            skillRegistry,
            designBrief,
          })),
        },
      ],
      temperature: 0,
      max_tokens: maxOutputTokens,
      provider: {
        require_parameters: requireParameters,
        allow_fallbacks: allowFallbacks,
      },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "skill_interview_plan",
          strict: true,
          schema,
        },
      },
    };

    const payload = await fetchProviderJsonWithTimeout({
      fetchImpl,
      endpoint,
      apiKey,
      body,
      timeoutMs,
      extraHeaders: {
        "http-referer": "https://github.com/molotovsingh/matter-workbench",
        "x-title": "Matter Workbench Skill Interview Planner",
      },
      timeoutMessage: `OpenRouter skill interview planner request timed out after ${timeoutMs}ms`,
      mapProviderError: mapOpenRouterPlannerError,
    });
    return parseOpenRouterJsonMessage(payload, "OpenRouter skill interview planner");
  };
}

function plannerUserPayload({ userRequest, skillIdea, activeMatter, skillRegistry, designBrief }) {
  return {
    task: "Plan a non-runnable skill idea interview.",
    user_skill_idea: userRequest,
    skill_idea: skillIdea,
    active_matter: activeMatter,
    skill_registry: skillRegistry,
    current_design_brief: designBrief,
    strict_rules: [
      "ask up to about 10 useful questions; fewer if enough context is already supplied",
      "if the user already supplied a detailed step-by-step skill specification, return zero questions",
      "if more than 10 questions are needed, put remaining topics in open_questions",
      "lawyer-readable labels",
      "specific to the requested skill",
      "do not ask already-inferred low-risk defaults",
      "no raw matter documents are provided or needed",
      "no skill generation",
      "no prompt generation",
      "no activation",
    ],
  };
}

function mapOpenAiPlannerError(response, payload) {
  const message = payload?.error?.message || `OpenAI returned ${response?.status || "an error"}`;
  const error = new Error(message);
  error.statusCode = response?.status >= 400 && response?.status < 500 ? 502 : 503;
  error.code = "provider.error";
  return error;
}

function mapOpenRouterPlannerError(response, payload) {
  const message = payload?.error?.message || `OpenRouter returned ${response?.status || "an error"}`;
  const error = new Error(message);
  error.statusCode = response?.status >= 400 && response?.status < 500 ? 502 : 503;
  error.code = "provider.error";
  return error;
}
