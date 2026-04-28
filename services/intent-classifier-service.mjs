import { resolveModelPolicy, AI_TASKS } from "../shared/model-policy.mjs";
import { DEFAULT_RESPONSES_ENDPOINT, requestResponsesJson } from "../shared/responses-client.mjs";

const VALID_INTENTS = new Set([
  "copilot_qa",
  "run_skill",
  "search",
  "skill_request",
  "greeting",
  "casual",
]);

const CLASSIFIER_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "matched_skill", "confidence", "reason"],
  properties: {
    intent: {
      type: "string",
      enum: [...VALID_INTENTS],
    },
    matched_skill: {
      type: "string",
      description: "The slash command of the matched skill, only for run_skill intent. Empty string otherwise.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    reason: {
      type: "string",
      description: "Brief explanation of why this intent was chosen.",
    },
  },
};

const GREETINGS = /^(hi|hello|hey|greetings|good morning|good afternoon|good evening|howdy|sup|yo)\b/i;
const CASUAL = /^(thanks|thank you|bye|goodbye|see you|later|ok|okay|cool|awesome|great|nice)\b/i;

export function createIntentClassifierService({
  skillRegistryService,
  env = process.env,
  endpoint = DEFAULT_RESPONSES_ENDPOINT,
} = {}) {
  if (!skillRegistryService) throw new Error("skillRegistryService is required");

  async function classifyIntent({ userInput, conversationHistory = [] } = {}) {
    if (!userInput || typeof userInput !== "string") {
      throw Object.assign(new Error("userInput is required"), { statusCode: 400 });
    }

    const trimmed = userInput.trim();

    if (trimmed.startsWith("/")) {
      return {
        intent: "run_skill",
        matched_skill: trimmed.split(/\s+/)[0],
        confidence: 1,
        reason: "Explicit slash command.",
      };
    }

    if (GREETINGS.test(trimmed)) {
      return {
        intent: "greeting",
        matched_skill: "",
        confidence: 1,
        reason: "Social greeting detected.",
      };
    }

    if (CASUAL.test(trimmed) && trimmed.split(/\s+/).length <= 3) {
      return {
        intent: "casual",
        matched_skill: "",
        confidence: 1,
        reason: "Casual remark detected.",
      };
    }

    const registry = await skillRegistryService.readRegistry();
    const modelPolicy = resolveModelPolicy(AI_TASKS.INTENT_CLASSIFIER, { env });

    const skills = (registry.skills || []).map((skill) => ({
      slash: skill.slash,
      category: skill.category,
      purpose: skill.purpose,
      inputs: skill.inputs,
      outputs: skill.outputs,
      mode: skill.mode,
    }));

    const raw = await requestResponsesJson({
      apiKey: env.OPENAI_API_KEY,
      endpoint,
      missingApiKeyMessage: "OPENAI_API_KEY is required for intent classification",
      body: {
        model: modelPolicy.model,
        max_output_tokens: modelPolicy.maxOutputTokens,
        input: [
          {
            role: "system",
            content: [
              "You are the Legal Workbench intent classifier.",
              "Classify the user's message into exactly one intent:",
              "",
              "copilot_qa — The user is asking a question about their legal matter, case, documents, or evidence. This includes any factual, legal, or procedural question about the matter at hand.",
              "run_skill — The user wants to execute an existing workflow skill (e.g. organize, extract, analyze, fix). Match to the best skill from the registry.",
              "search — The user wants to find or locate specific content within their documents (e.g. find all emails, locate the contract).",
              "skill_request — The user wants to create a new skill, modify an existing skill, or tune how a skill works. This is about changing the toolset, not using it.",
              "greeting — Social greeting (hi, hello, etc.).",
              "casual — Casual remark not requiring any action (thanks, bye, etc.).",
              "",
              "Key distinctions:",
              "- 'What does the contract say about termination?' → copilot_qa (answering a question about the matter)",
              "- 'Extract the PDFs' → run_skill (executing /extract)",
              "- 'Create a timeline of events' → run_skill (executing /create_listofdates)",
              "- 'Find all emails from the plaintiff' → search (locating specific content)",
              "- 'I need a skill for drafting motions' → skill_request (wants to create/modify a skill)",
              "- 'Organize my intake documents' → run_skill (executing /matter-init)",
              "",
              "CONVERSATION CONTEXT IS CRITICAL:",
              "- If there is recent conversation history where the user was asking copilot questions, follow-up messages like 'recheck the math', 'show me a table', 'what about the other party', 'go deeper', 'summarize that' are STILL copilot_qa — they refine or extend the previous answer.",
              "- Only classify as run_skill or skill_request if the user is clearly requesting a workflow action (organize, extract, create timeline, fix, build, run a process).",
              "- Formatting requests ('neat table', 'itemise it', 'bullet points') about previously discussed content are copilot_qa follow-ups, NOT skill requests.",
              "",
              "When intent is run_skill, set matched_skill to the slash command of the best matching skill from the registry.",
              "When intent is NOT run_skill, set matched_skill to an empty string.",
              "Return only JSON in the requested schema.",
            ].join("\n"),
          },
          ...conversationHistory.slice(-6),
          {
            role: "user",
            content: JSON.stringify({
              user_message: trimmed,
              available_skills: skills,
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "intent_classification",
            description: "Classifies a user message into a Legal Workbench intent.",
            strict: true,
            schema: CLASSIFIER_OUTPUT_SCHEMA,
          },
        },
      },
    });

    return normalizeClassification(raw, registry);
  }

  return { classifyIntent };
}

function normalizeClassification(raw, registry) {
  const skillsBySlash = new Map((registry.skills || []).map((skill) => [skill.slash, skill]));
  const intent = VALID_INTENTS.has(raw.intent) ? raw.intent : "copilot_qa";
  const rawSkill = typeof raw.matched_skill === "string" ? raw.matched_skill : "";
  const matchedSkill = intent === "run_skill" && skillsBySlash.has(rawSkill) ? rawSkill : "";
  const confidence = clamp01(raw.confidence);
  const reason = collapseWhitespace(raw.reason || "");

  if (intent === "run_skill" && !matchedSkill && rawSkill) {
    return {
      intent: "skill_request",
      matched_skill: "",
      confidence: confidence * 0.8,
      reason: `Requested skill ${rawSkill} not found in registry. ${reason}`,
    };
  }

  return { intent, matched_skill: matchedSkill, confidence, reason };
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
