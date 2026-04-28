import { resolveModelPolicy, AI_TASKS } from "../shared/model-policy.mjs";
import { DEFAULT_RESPONSES_ENDPOINT, requestResponsesJson } from "../shared/responses-client.mjs";
import { DEFAULT_OPENAI_MODEL } from "../shared/ai-defaults.mjs";
import { isInsideRoot, resolveRelativeInside } from "../shared/safe-paths.mjs";
import fs from "fs";
import path from "path";

const MAX_CONTEXT_CHARS = 32000;

export function createMatterQaService({ matterStore, env = process.env } = {}) {
  if (!matterStore) throw new Error("matterStore is required");

  async function answerQuestion({ question, matterRoot } = {}) {
    if (!question || typeof question !== "string") {
      throw Object.assign(new Error("question is required"), { statusCode: 400 });
    }
    const root = matterRoot || matterStore.ensureMatterRoot();
    const context = await buildMatterContext(root);
    const modelPolicy = resolveModelPolicy(AI_TASKS.MATTER_QA, { env });

    const answer = await requestResponsesJson({
      apiKey: env.OPENAI_API_KEY,
      endpoint: DEFAULT_RESPONSES_ENDPOINT,
      missingApiKeyMessage: "OPENAI_API_KEY is required for matter Q&A",
      body: {
        model: modelPolicy.model,
        max_output_tokens: modelPolicy.maxOutputTokens,
        input: [
          {
            role: "system",
            content: [
              "You are a legal matter assistant.",
              "Answer questions using only the provided matter context.",
              "Include source citations using the format FILE-NNNN pX.bY when referencing extraction records.",
              "If the answer is not in the context, say so clearly.",
              "Be concise and cite specific documents when possible.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
              question,
              matter_context: context,
            }),
          },
        ],
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

    return {
      answer: answer.answer || "No answer generated.",
      sources: Array.isArray(answer.sources) ? answer.sources : [],
      confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
      question,
    };
  }

  return { answerQuestion };
}

async function buildMatterContext(matterRoot) {
  const parts = [];

  const matterJsonPath = path.join(matterRoot, "matter.json");
  if (fs.existsSync(matterJsonPath)) {
    parts.push(`[matter.json]\n${fs.readFileSync(matterJsonPath, "utf8")}`);
  }

  const inboxPath = path.join(matterRoot, "00_Inbox");
  if (fs.existsSync(inboxPath)) {
    const intakes = fs.readdirSync(inboxPath).filter((f) => fs.statSync(path.join(inboxPath, f)).isDirectory());
    for (const intake of intakes) {
      const registerPath = path.join(inboxPath, intake, "File Register.csv");
      if (fs.existsSync(registerPath)) {
        parts.push(`[${intake}/File Register.csv]\n${fs.readFileSync(registerPath, "utf8")}`);
      }
    }
  }

  const libraryPath = path.join(matterRoot, "10_Library");
  if (fs.existsSync(libraryPath)) {
    const records = collectExtractionRecords(libraryPath);
    for (const record of records.slice(0, 50)) {
      parts.push(`[extraction record]\n${JSON.stringify(record).slice(0, 2000)}`);
    }
  }

  const fullContext = parts.join("\n\n---\n\n");
  return fullContext.length > MAX_CONTEXT_CHARS
    ? fullContext.slice(0, MAX_CONTEXT_CHARS) + "\n...[truncated]"
    : fullContext;
}

function collectExtractionRecords(dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectExtractionRecords(fullPath));
      } else if (entry.name.endsWith(".json")) {
        try {
          results.push(JSON.parse(fs.readFileSync(fullPath, "utf8")));
        } catch {
          // skip unreadable files
        }
      }
    }
  } catch {
    // skip inaccessible directories
  }
  return results;
}
