import { createIntentClassifierService } from "./intent-classifier-service.mjs";
import { createMatterQaService } from "./matter-qa-service.mjs";
import { createMatterSearchService } from "./matter-search-service.mjs";
import { createSkillRouterService } from "./skill-router-service.mjs";
import { isLocalOnlyIntent } from "../shared/local-intent.mjs";

const SEARCH_VERB_PREFIX = /^(?:find|search\s*(?:for)?|look\s*(?:for)?|locate|show\s*me)\s+/i;

export function extractSearchQuery(userInput) {
  const stripped = userInput.replace(SEARCH_VERB_PREFIX, "").trim();
  return stripped || userInput;
}

export function createUniboxService({
  matterStore,
  skillRegistryService,
  skillRouterService = null,
  env = process.env,
} = {}) {
  if (!matterStore) throw new Error("matterStore is required");
  if (!skillRegistryService) throw new Error("skillRegistryService is required");

  const classifier = createIntentClassifierService({ skillRegistryService, env });
  const qaService = createMatterQaService({ matterStore, env });
  const searchService = createMatterSearchService({ matterStore });
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

    if (!matterStore.getMatterRoot()) {
      if (userInput.trim().startsWith("/")) return NO_MATTER_ERROR;
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
          result: await skillRouter.checkIntent({ userRequest: userInput }),
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
        const routerResult = await skillRouter.checkIntent({ userRequest: userInput });
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
            message: "Hello! I'm your legal workbench assistant. I can help you with:\n\n• **Ask questions** about your current matter\n• **Search** across matter documents\n• **Run skills** like `/extract` or `/doctor`\n• **Create or modify** skills\n\nWhat would you like to do?",
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
