import { DEFAULT_OPENAI_MODEL } from "../shared/ai-defaults.mjs";
import {
  AI_TASKS,
  DEFAULT_ROUTER_MAX_OUTPUT_TOKENS,
  resolveModelPolicy,
} from "../shared/model-policy.mjs";
import { DEFAULT_RESPONSES_ENDPOINT, requestResponsesJson } from "../shared/responses-client.mjs";

const STATE_MARKER = "Skill design state.";
const NEW_SKILL_COMMAND = /^\/new_skill(?:\s+(.+))?$/i;
const CANCEL = /^(?:cancel|stop|exit|never mind|nevermind)$/i;
const START_OVER = /^(?:start over|restart|reset)$/i;
const ANSWER_ONCE = /^(?:answer once|answer it once|just answer|answer this once)$/i;
const MAKE_REUSABLE = /^(?:make reusable|make it reusable|reusable skill|turn it into a skill|design a skill)$/i;
const CHECK_OVERLAP = /^(?:check overlap|check mece|check against existing skills|route it|run router)$/i;

const SLOT_ORDER = [
  "purpose",
  "source_material",
  "output",
  "workflow_stage",
  "audience",
  "source_citation_expectation",
  "matter_dependence",
  "legal_setting",
];

const SLOT_LABELS = {
  skill_name: "Skill name",
  purpose: "Purpose",
  source_material: "Inputs",
  output: "Output",
  workflow_stage: "Workflow stage",
  audience: "Audience",
  source_citation_expectation: "Source and citation rules",
  matter_dependence: "Matter scope",
  legal_setting: "Legal setting",
};

const SLOT_QUESTIONS = {
  purpose: "What should the skill do, in one plain sentence?",
  source_material: "What should it read: extracted records, List of Dates, pleadings, emails, or the whole matter?",
  output: "What should it produce: checklist, chronology, draft, issue note, table, or something else?",
  workflow_stage: "When should it run in the matter workflow?",
  audience: "Who is the output for: lawyer, client, court prep, internal review, or someone else?",
  source_citation_expectation: "Should every point cite source records, and should unsupported points be called out separately?",
  matter_dependence: "Should this work across any matter, property-dispute matters like this one, or only this specific matter?",
  legal_setting: "Any legal setting to bake in, such as jurisdiction, forum, case type, stage, side, or relief? Say 'general' if not.",
};

const SKILL_DESIGN_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["slots", "next_question", "reason"],
  properties: {
    slots: {
      type: "object",
      additionalProperties: false,
      required: [
        "skill_name",
        "purpose",
        "source_material",
        "output",
        "workflow_stage",
        "audience",
        "source_citation_expectation",
        "matter_dependence",
        "legal_setting",
      ],
      properties: Object.fromEntries(["skill_name", ...SLOT_ORDER].map((slot) => [slot, { type: "string" }])),
    },
    next_question: {
      type: "string",
    },
    reason: {
      type: "string",
    },
  },
};

export function createSkillDesignService({
  aiProvider,
  env = process.env,
  endpoint = DEFAULT_RESPONSES_ENDPOINT,
} = {}) {
  const modelPolicy = resolveModelPolicy(AI_TASKS.SKILL_ROUTER, { env });
  const provider = aiProvider || createOpenAiSkillDesignProvider({
    apiKey: env.OPENAI_API_KEY,
    endpoint,
    model: modelPolicy.model,
    maxOutputTokens: Math.min(modelPolicy.maxOutputTokens, DEFAULT_ROUTER_MAX_OUTPUT_TOKENS),
  });

  async function processTurn({ userInput, conversationHistory = [], hasMatter = false } = {}) {
    const trimmed = String(userInput || "").trim();
    const commandText = matchNewSkillCommand(trimmed);
    const existingState = parseSkillDesignState(conversationHistory);

    if (commandText !== null) {
      const state = createInitialState();
      if (!commandText) return buildStartResult(state);
      return handleSkillThought({
        state,
        userInput: commandText,
        hasMatter,
        provider,
      });
    }

    if (!existingState?.active) {
      return buildStartResult(createInitialState());
    }

    if (CANCEL.test(trimmed)) {
      return buildResult("Skill design cancelled. No skill was created or changed.", {
        ...existingState,
        active: false,
        phase: "cancelled",
      });
    }

    if (START_OVER.test(trimmed)) {
      return buildStartResult(createInitialState());
    }

    if (CHECK_OVERLAP.test(trimmed)) {
      if (!isBriefReady(existingState)) {
        const nextSlot = firstMissingSlot(existingState);
        const nextState = {
          ...existingState,
          expectedSlot: nextSlot,
          phase: "collecting",
        };
        return buildResult([
          "I need one more detail before checking overlap.",
          "",
          formatSlotPrompt(nextState, nextSlot),
        ].join("\n"), nextState);
      }
      return {
        action: "check_overlap",
        routerRequest: buildRouterRequest(existingState),
      };
    }

    if (ANSWER_ONCE.test(trimmed)) {
      return {
        action: "answer_once",
        question: existingState.originalRequest || existingState.slots.purpose || "",
        state: existingState,
        historySummary: buildHistorySummary(existingState),
      };
    }

    if (MAKE_REUSABLE.test(trimmed)) {
      const state = {
        ...existingState,
        phase: "collecting",
        reusableChoice: "reusable",
        expectedSlot: "",
        slots: {
          ...existingState.slots,
          purpose: existingState.slots.purpose || existingState.originalRequest,
          matter_dependence: existingState.reusableChoice ? existingState.slots.matter_dependence : "",
        },
      };
      return askNextQuestion(state);
    }

    return handleSkillThought({
      state: existingState,
      userInput: trimmed,
      hasMatter,
      provider,
    });
  }

  return {
    hasActiveState: (history) => Boolean(parseSkillDesignState(history)?.active),
    isNewSkillCommand: (value) => matchNewSkillCommand(value) !== null,
    parseState: parseSkillDesignState,
    processTurn,
    start: () => buildStartResult(createInitialState()),
  };
}

export function createOpenAiSkillDesignProvider({
  apiKey,
  model = DEFAULT_OPENAI_MODEL,
  endpoint = DEFAULT_RESPONSES_ENDPOINT,
  maxOutputTokens = DEFAULT_ROUTER_MAX_OUTPUT_TOKENS,
} = {}) {
  return async function openAiSkillDesignProvider({ state, userInput, hasMatter, schema }) {
    return requestResponsesJson({
      apiKey,
      endpoint,
      missingApiKeyMessage: "OPENAI_API_KEY is required for skill design",
      body: {
        model,
        max_output_tokens: maxOutputTokens,
        input: [
          {
            role: "system",
            content: [
              "You help design Legal Workbench skills.",
              "Update the supplied skill-design slots from the latest user message.",
              "Do not invent details the user did not provide.",
              "If the user answers the expected slot, put that answer into that slot.",
              "Use short, lawyer-readable phrases.",
              "Return only JSON in the requested schema.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
              latest_user_message: userInput,
              has_active_matter: Boolean(hasMatter),
              expected_slot: state.expectedSlot || "",
              current_slots: state.slots,
              slot_questions: SLOT_QUESTIONS,
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "skill_design_update",
            description: "Updates a guided Legal Workbench skill-design brief.",
            strict: true,
            schema,
          },
        },
      },
    });
  };
}

function handleSkillThought({ state, userInput, hasMatter, provider }) {
  if (!state.originalRequest && isOneOffMatterQuestion(userInput)) {
    const nextState = {
      ...state,
      phase: "awaiting_one_off_choice",
      originalRequest: userInput,
      slots: {
        ...state.slots,
        purpose: userInput,
        matter_dependence: hasMatter ? "Matter-specific unless made reusable." : "",
      },
    };
    const message = hasMatter
      ? "That sounds like something I can answer once for this matter, or turn into a reusable skill. Reply `answer once` or `make reusable`."
      : "That sounds matter-specific. No matter is loaded, so I can help design a reusable skill now, or you can load a matter and ask me to answer it once. Reply `make reusable` or `cancel`.";
    return buildResult(message, nextState, {
      choices: hasMatter ? ["answer once", "make reusable"] : ["make reusable", "cancel"],
    });
  }

  return collectSkillDetails({ state, userInput, hasMatter, provider });
}

async function collectSkillDetails({ state, userInput, hasMatter = false, provider }) {
  const nextState = {
    ...state,
    phase: "collecting",
    reusableChoice: state.reusableChoice || "reusable",
    slots: {
      ...state.slots,
    },
  };

  if (state.expectedSlot) {
    nextState.slots[state.expectedSlot] = collapseWhitespace(userInput);
  } else {
    const raw = await provider({
      state,
      userInput,
      hasMatter,
      schema: SKILL_DESIGN_OUTPUT_SCHEMA,
    });
    mergeProviderSlots(nextState.slots, raw?.slots || {});
  }

  if (isBriefReady(nextState)) {
    nextState.phase = "brief_ready";
    nextState.expectedSlot = "";
    nextState.briefMarkdown = buildBriefMarkdown(nextState);
    return buildResult(
      [
        "Here is the skill brief.",
        "",
        nextState.briefMarkdown,
        "Reply `check overlap` when you want me to compare it against the existing skill registry.",
      ].join("\n"),
      nextState,
      { briefMarkdown: nextState.briefMarkdown },
    );
  }

  return askNextQuestion(nextState);
}

function askNextQuestion(state) {
  const nextSlot = firstMissingSlot(state);
  const nextState = {
    ...state,
    phase: "collecting",
    expectedSlot: nextSlot,
  };
  return buildResult(formatSlotPrompt(nextState, nextSlot), nextState);
}

function buildStartResult(state) {
  return buildResult("Skill design started. Tell me what you want in simple terms.", {
    ...state,
    phase: "awaiting_request",
  });
}

function buildResult(message, state, patch = {}) {
  return {
    message,
    state: publicState(state),
    choices: patch.choices || [],
    briefMarkdown: patch.briefMarkdown || state.briefMarkdown || "",
    historySummary: buildHistorySummary(state),
  };
}

function buildHistorySummary(state) {
  return `${STATE_MARKER}\nstate_json=${JSON.stringify(state)}`;
}

function parseSkillDesignState(history = []) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const content = String(history[index]?.content || "");
    if (!content.includes(STATE_MARKER)) continue;
    const line = content.split("\n").find((item) => item.startsWith("state_json="));
    if (!line) continue;
    try {
      return normalizeState(JSON.parse(line.slice("state_json=".length)));
    } catch {
      return null;
    }
  }
  return null;
}

function createInitialState() {
  return normalizeState({
    active: true,
    phase: "awaiting_request",
    originalRequest: "",
    reusableChoice: "",
    expectedSlot: "",
    briefMarkdown: "",
    slots: emptySlots(),
  });
}

function normalizeState(value = {}) {
  return {
    active: value.active !== false,
    phase: collapseWhitespace(value.phase || "awaiting_request"),
    originalRequest: collapseWhitespace(value.originalRequest || ""),
    reusableChoice: collapseWhitespace(value.reusableChoice || ""),
    expectedSlot: SLOT_ORDER.includes(value.expectedSlot) ? value.expectedSlot : "",
    briefMarkdown: String(value.briefMarkdown || ""),
    slots: {
      ...emptySlots(),
      ...(value.slots && typeof value.slots === "object" ? value.slots : {}),
    },
  };
}

function emptySlots() {
  return {
    skill_name: "",
    purpose: "",
    source_material: "",
    output: "",
    workflow_stage: "",
    audience: "",
    source_citation_expectation: "",
    matter_dependence: "",
    legal_setting: "",
  };
}

function publicState(state) {
  return {
    phase: state.phase,
    expectedSlot: state.expectedSlot,
    expectedSlotLabel: SLOT_LABELS[state.expectedSlot] || "",
    progress: buildProgress(state),
    slots: state.slots,
  };
}

function isOneOffMatterQuestion(value) {
  const text = String(value || "").trim();
  return /^(?:what|which|why|how|when|who|where|can|should|would|is|are)\b/i.test(text)
    || /\?$/.test(text);
}

function matchNewSkillCommand(value) {
  const match = String(value || "").trim().match(NEW_SKILL_COMMAND);
  if (!match) return null;
  return collapseWhitespace(match[1] || "");
}

function firstMissingSlot(state) {
  return SLOT_ORDER.find((slot) => !collapseWhitespace(state.slots?.[slot])) || "";
}

function isBriefReady(state) {
  return SLOT_ORDER.every((slot) => Boolean(collapseWhitespace(state.slots?.[slot])));
}

function formatSlotPrompt(state, slot) {
  const position = Math.max(1, SLOT_ORDER.indexOf(slot) + 1);
  return [
    `Next question (${position}/${SLOT_ORDER.length}) - ${SLOT_LABELS[slot]}:`,
    SLOT_QUESTIONS[slot],
    "Reply in a phrase or sentence. You can also type `cancel` or `start over`.",
  ].join("\n");
}

function buildProgress(state) {
  const answered = SLOT_ORDER.filter((slot) => Boolean(collapseWhitespace(state.slots?.[slot]))).length;
  const current = state.expectedSlot
    ? SLOT_ORDER.indexOf(state.expectedSlot) + 1
    : Math.min(answered, SLOT_ORDER.length);
  return {
    answered,
    current: Math.max(0, current),
    total: SLOT_ORDER.length,
  };
}

function mergeProviderSlots(target, source) {
  for (const [slot, value] of Object.entries(source)) {
    if (!(slot in target)) continue;
    const normalized = collapseWhitespace(value);
    if (normalized) target[slot] = normalized;
  }
}

function buildBriefMarkdown(state) {
  const slots = {
    ...state.slots,
    skill_name: state.slots.skill_name || suggestSkillName(state),
  };
  return [
    `## ${slots.skill_name}`,
    "",
    `- **${SLOT_LABELS.purpose}:** ${slots.purpose}`,
    `- **${SLOT_LABELS.source_material}:** ${slots.source_material}`,
    `- **${SLOT_LABELS.output}:** ${slots.output}`,
    `- **${SLOT_LABELS.workflow_stage}:** ${slots.workflow_stage}`,
    `- **${SLOT_LABELS.audience}:** ${slots.audience}`,
    `- **${SLOT_LABELS.source_citation_expectation}:** ${slots.source_citation_expectation}`,
    `- **${SLOT_LABELS.matter_dependence}:** ${slots.matter_dependence}`,
    `- **${SLOT_LABELS.legal_setting}:** ${slots.legal_setting}`,
  ].join("\n");
}

function buildRouterRequest(state) {
  return [
    "Proposed Legal Workbench skill:",
    buildBriefMarkdown(state),
  ].join("\n\n");
}

function suggestSkillName(state) {
  const purpose = collapseWhitespace(state.slots.purpose || state.originalRequest || "Skill");
  if (/weak/i.test(purpose) && /fact/i.test(purpose)) return "Weak Facts Analysis";
  if (/hearing/i.test(purpose)) return "Hearing Preparation";
  return purpose
    .split(/\s+/)
    .filter((word) => !/^(?:a|an|the|to|for|in|of|and|or|with|from|what|are|is)$/i.test(word))
    .slice(0, 4)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ") || "New Skill";
}

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
