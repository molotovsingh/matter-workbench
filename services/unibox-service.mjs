import { createSkillRouterService } from "./skill-router-service.mjs";
import { createMatterQaService } from "./matter-qa-service.mjs";
import { createMatterSearchService } from "./matter-search-service.mjs";

const QUESTION_STARTERS = /\b(what|who|where|when|why|how|is|are|does|do|can|could|would|should|tell me|explain|describe|list|show me)\b/i;
const SEARCH_STARTERS = /\b(find|search|look for|locate|get me)\b/i;

export function createUniboxService({
  matterStore,
  skillRegistryService,
  env = process.env,
} = {}) {
  if (!matterStore) throw new Error("matterStore is required");
  if (!skillRegistryService) throw new Error("skillRegistryService is required");

  const qaService = createMatterQaService({ matterStore, env });
  const searchService = createMatterSearchService({ matterStore });
  const skillRouter = createSkillRouterService({ registryService: skillRegistryService, env });

  async function processInput({ userInput } = {}) {
    if (!userInput || typeof userInput !== "string") {
      throw Object.assign(new Error("userInput is required"), { statusCode: 400 });
    }

    const trimmed = userInput.trim();
    const intent = detectIntent(trimmed);

    switch (intent) {
      case "run_skill": {
        const slash = trimmed.split(/\s+/)[0];
        return {
          intent: "run_skill",
          displayType: "skill_router",
          result: await skillRouter.checkIntent({ userRequest: trimmed }),
          nextActions: ["run_skill", "modify_skill", "new_skill"],
        };
      }

      case "matter_qa": {
        try {
          const answer = await qaService.answerQuestion({ question: trimmed });
          return {
            intent: "matter_qa",
            displayType: "qa_answer",
            result: answer,
            nextActions: ["search", "ask_another"],
          };
        } catch (error) {
          if (error.statusCode === 400 && !matterStore.hasMatterRoot?.()) {
            return {
              intent: "matter_qa",
              displayType: "error",
              result: { message: "Load a matter first before asking questions about it." },
              nextActions: ["load_matter"],
            };
          }
          throw error;
        }
      }

      case "search": {
        try {
          const searchQuery = trimmed.replace(SEARCH_STARTERS, "").trim();
          const results = await searchService.search({ query: searchQuery });
          return {
            intent: "search",
            displayType: "search_results",
            result: results,
            nextActions: ["ask_about_result", "refine_search"],
          };
        } catch (error) {
          if (error.statusCode === 400 && !matterStore.hasMatterRoot?.()) {
            return {
              intent: "search",
              displayType: "error",
              result: { message: "Load a matter first before searching." },
              nextActions: ["load_matter"],
            };
          }
          throw error;
        }
      }

      default: {
        const routerResult = await skillRouter.checkIntent({ userRequest: trimmed });
        return {
          intent: "skill_router",
          displayType: "skill_router",
          result: routerResult,
          nextActions: ["run_skill", "modify_skill", "new_skill", "ask_qa", "search"],
        };
      }
    }
  }

  return { processInput };
}

function detectIntent(input) {
  if (input.startsWith("/")) return "run_skill";
  if (QUESTION_STARTERS.test(input)) return "matter_qa";
  if (SEARCH_STARTERS.test(input)) return "search";
  return "unknown";
}
