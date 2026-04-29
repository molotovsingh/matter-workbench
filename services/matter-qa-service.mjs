import { resolveModelPolicy, AI_TASKS } from "../shared/model-policy.mjs";
import { DEFAULT_RESPONSES_ENDPOINT, requestResponsesJson } from "../shared/responses-client.mjs";
import { createMatterContextService } from "./matter-context-service.mjs";

const MAX_CONVERSATION_TURNS = 10;

export function createMatterQaService({ matterStore, env = process.env } = {}) {
  if (!matterStore) throw new Error("matterStore is required");

  const conversationStore = new Map();
  const matterContextService = createMatterContextService({ matterStore });

  function getConversation(matterRoot) {
    if (!conversationStore.has(matterRoot)) {
      conversationStore.set(matterRoot, []);
    }
    return conversationStore.get(matterRoot);
  }

  function resetConversation(matterRoot) {
    conversationStore.set(matterRoot, []);
  }

  async function answerQuestion({ question, matterRoot, conversationHistory = [] } = {}) {
    if (!question || typeof question !== "string") {
      throw Object.assign(new Error("question is required"), { statusCode: 400 });
    }
    const root = matterRoot || matterStore.ensureMatterRoot();
    const context = await matterContextService.buildMatterContext(root);
    const modelPolicy = resolveModelPolicy(AI_TASKS.MATTER_QA, { env });

    const messages = [
      {
        role: "system",
        content: [
          "You are a legal matter assistant.",
          "Answer questions using only the provided matter context.",
          "Include source citations using the format FILE-NNNN pX.bY when referencing extraction records.",
          "If the answer is not in the context, say so clearly.",
          "Be concise and cite specific documents when possible.",
          "Maintain conversation context from previous questions and answers.",
        ].join(" "),
      },
      ...conversationHistory,
      {
        role: "user",
        content: JSON.stringify({
          question,
          matter_context: context,
        }),
      },
    ];

    const answer = await requestResponsesJson({
      apiKey: env.OPENAI_API_KEY,
      endpoint: DEFAULT_RESPONSES_ENDPOINT,
      missingApiKeyMessage: "OPENAI_API_KEY is required for matter Q&A",
      body: {
        model: modelPolicy.model,
        max_output_tokens: modelPolicy.maxOutputTokens,
        input: messages,
        text: {
          format: {
            type: "json_schema",
            name: "matter_qa_answer",
            description: "Answer to a matter-related question with sources.",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["answer", "sources", "confidence"],
              properties: {
                answer: { type: "string" },
                sources: {
                  type: "array",
                  items: { type: "string" },
                },
                confidence: {
                  type: "number",
                  minimum: 0,
                  maximum: 1,
                },
              },
            },
          },
        },
      },
    });

    const updatedHistory = [
      ...conversationHistory,
      { role: "user", content: question },
      { role: "assistant", content: answer.answer || "No answer generated." },
    ].slice(-MAX_CONVERSATION_TURNS * 2);

    return {
      answer: answer.answer || "No answer generated.",
      sources: Array.isArray(answer.sources) ? answer.sources : [],
      confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
      question,
      conversationHistory: updatedHistory,
    };
  }

  return { answerQuestion, getConversation, resetConversation };
}
