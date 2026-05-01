import { createIntentClassifierService } from "./intent-classifier-service.mjs";
import { createMatterQaService } from "./matter-qa-service.mjs";
import { createMatterSearchService } from "./matter-search-service.mjs";
import { createSkillDesignService } from "./skill-design-service.mjs";
import { createSkillRouterService } from "./skill-router-service.mjs";
import { isLocalOnlyIntent } from "../shared/local-intent.mjs";

const SEARCH_VERB_PREFIX = /^(?:find|search\s*(?:for)?|look\s*(?:for)?|locate|show\s*me)\s+/i;

export function extractSearchQuery(userInput) {
  const stripped = userInput.replace(SEARCH_VERB_PREFIX, "").trim();
  return stripped || userInput;
}

export function createUniboxService({
  matterStore,
  skillDesignService = null,
  skillRegistryService,
  skillRouterService = null,
  env = process.env,
} = {}) {
  if (!matterStore) throw new Error("matterStore is required");
  if (!skillRegistryService) throw new Error("skillRegistryService is required");

  const classifier = createIntentClassifierService({ skillRegistryService, env });
  const qaService = createMatterQaService({ matterStore, env });
  const searchService = createMatterSearchService({ matterStore });
  const skillDesign = skillDesignService || createSkillDesignService({ env });
  const skillRouter = skillRouterService || createSkillRouterService({ registryService: skillRegistryService, env });

  const NO_MATTER_ERROR = {
    intent: "copilot_qa",
    displayType: "error",
    result: { message: "Load a matter first before asking questions or searching." },
  };

  async function processInput({ userInput, conversationHistory = [] } = {}) {
    if (!userInput || typeof userInput !== "string") {
      throw Object.assign(new Error("userInput is required"), { statusCode: 400 });
    }

    const trimmed = userInput.trim();
    const hasMatter = Boolean(matterStore.getMatterRoot());

    if (skillDesign.isNewSkillCommand(trimmed) || skillDesign.hasActiveState(conversationHistory)) {
      const designTurn = await skillDesign.processTurn({
        userInput: trimmed,
        conversationHistory,
        hasMatter,
      });

      if (designTurn.action === "answer_once") {
        if (!hasMatter) {
          return {
            intent: "skill_design",
            displayType: "skill_design",
            result: {
              message: "Load a matter first before I answer that once. If you want a reusable skill instead, reply `make reusable`.",
              choices: ["make reusable", "cancel"],
              historySummary: designTurn.historySummary || "",
            },
          };
        }
        const matterRoot = matterStore.ensureMatterRoot();
        const answer = await qaService.answerQuestion({
          question: designTurn.question,
          matterRoot,
          conversationHistory: [],
        });
        return {
          intent: "copilot_qa",
          displayType: "qa_answer",
          result: answer,
          conversationHistory: answer.conversationHistory,
        };
      }

      if (designTurn.action === "check_overlap") {
        const routerResult = await skillRouter.checkIntent({
          userRequest: designTurn.routerRequest,
          conversationHistory,
        });
        return {
          intent: "skill_request",
          displayType: "skill_router",
          result: routerResult,
          conversationHistory: appendRouterHistory({
            conversationHistory,
            userInput: trimmed,
            routerResult,
            skillDesignHistorySummary: designTurn.historySummary,
          }),
        };
      }

      return {
        intent: "skill_design",
        displayType: "skill_design",
        result: designTurn,
      };
    }

    if (!hasMatter) {
      if (trimmed.startsWith("/")) return NO_MATTER_ERROR;
      if (!isLocalOnlyIntent(userInput)) return NO_MATTER_ERROR;
    }

    const classification = await classifier.classifyIntent({ userInput, conversationHistory });

    switch (classification.intent) {
      case "copilot_qa": {
        const matterRoot = matterStore.ensureMatterRoot();
        const answer = await qaService.answerQuestion({
          question: userInput,
          matterRoot,
          conversationHistory,
        });
        return {
          intent: "copilot_qa",
          displayType: "qa_answer",
          result: answer,
          conversationHistory: answer.conversationHistory,
        };
      }

      case "run_skill": {
        const slash = classification.matched_skill || userInput.trim().split(/\s+/)[0];
        return {
          intent: "run_skill",
          displayType: "skill_router",
          result: await skillRouter.checkIntent({ userRequest: userInput, conversationHistory }),
          matchedSkill: slash,
        };
      }

      case "search": {
        const searchQuery = extractSearchQuery(userInput);
        const results = await searchService.search({ query: searchQuery });
        return {
          intent: "search",
          displayType: "search_results",
          result: results,
        };
      }

      case "skill_request": {
        const routerResult = await skillRouter.checkIntent({ userRequest: userInput, conversationHistory });
        if (needsSkillDesignGuidance(routerResult)) {
          return {
            intent: "skill_design",
            displayType: "skill_design",
            result: skillDesign.start(),
          };
        }
        return {
          intent: "skill_request",
          displayType: "skill_router",
          result: routerResult,
        };
      }

      case "greeting": {
        return {
          intent: "greeting",
          displayType: "chat_response",
          result: {
            message: "Hello! I'm your legal workbench assistant. I can help you with:\n\n• **Ask questions** about your current matter\n• **Search** across matter documents\n• **Run skills** like `/extract` or `/doctor`\n• **Design a new skill** with `/new_skill`\n\nWhat would you like to do?",
          },
        };
      }

      case "casual": {
        return {
          intent: "casual",
          displayType: "chat_response",
          result: {
            message: "Got it! Let me know if you need help with your legal matters.",
          },
        };
      }

      default: {
        return {
          intent: "copilot_qa",
          displayType: "chat_response",
          result: { message: "I'm not sure what you need. Try asking a question about your matter, or type a slash command like `/extract`." },
        };
      }
    }
  }

  return { processInput };
}

function needsSkillDesignGuidance(routerResult = {}) {
  return routerResult.decision === "needs_user_approval"
    && !routerResult.matched_skill
    && !routerResult.mece_violation
    && (!routerResult.recommended_action || routerResult.recommended_action === "none");
}

function appendRouterHistory({
  conversationHistory = [],
  userInput = "",
  routerResult = {},
  skillDesignHistorySummary = "",
} = {}) {
  return [
    ...conversationHistory,
    { role: "user", content: userInput },
    {
      role: "assistant",
      content: [
        summarizeRouterResult(routerResult),
        skillDesignHistorySummary,
      ].filter(Boolean).join("\n"),
    },
  ].slice(-20);
}

function summarizeRouterResult(routerResult = {}) {
  return [
    "Skill router result.",
    `decision=${routerResult.decision || ""}`,
    `recommended_action=${routerResult.recommended_action || ""}`,
    `matched_skill=${routerResult.matched_skill || ""}`,
    `user_gate_required=${routerResult.user_gate_required ? "yes" : "no"}`,
    `reason=${routerResult.reason || ""}`,
    `next_action=${routerResult.suggested_next_action || ""}`,
  ].join("\n");
}
