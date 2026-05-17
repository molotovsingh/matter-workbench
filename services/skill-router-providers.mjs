import { DEFAULT_OPENAI_MODEL } from "../shared/ai-defaults.mjs";
import { legalWorkbenchSystemPrompt } from "../shared/legal-workbench-policy-prompt.mjs";
import { DEFAULT_ROUTER_MAX_OUTPUT_TOKENS } from "../shared/model-policy.mjs";
import { DEFAULT_RESPONSES_ENDPOINT, requestResponsesJson } from "../shared/responses-client.mjs";

const SKILL_ROUTER_SYSTEM_PROMPT = legalWorkbenchSystemPrompt([
  "You are the Legal Workbench skill router.",
  "Classify a user's skill request against the supplied skill registry.",
  "Be MECE: do not recommend duplicate skills when an existing skill has the same category, goal, input contract, and output contract.",
  "If there is a direct MECE violation, recommend modifying the existing skill and require user approval.",
  "Treat expert preferences or legal heuristics as skill tuning, not a new executable workflow.",
  "Be legal-setting aware: forum, jurisdiction, case type, procedural stage, side, relief, and audience may justify profiles or tuning before new skills.",
  "All AI legal work product should be markdown-first until export/print skills are mature; DOCX/PDF belong to Export skills.",
  "Return only JSON in the requested schema.",
], {
  customSkill: true,
  sourceVisibility: false,
});

export function createOpenAiSkillRouterProvider({
  apiKey,
  model = DEFAULT_OPENAI_MODEL,
  endpoint = DEFAULT_RESPONSES_ENDPOINT,
  maxOutputTokens = DEFAULT_ROUTER_MAX_OUTPUT_TOKENS,
} = {}) {
  return async function openAiSkillRouterProvider({ userRequest, overrideJustification, registry, schema }) {
    return requestResponsesJson({
      apiKey,
      endpoint,
      missingApiKeyMessage: "OPENAI_API_KEY is required for skill intent routing",
      body: {
        model,
        max_output_tokens: maxOutputTokens,
        input: [
          {
            role: "system",
            content: SKILL_ROUTER_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify({
              user_request: userRequest,
              override_justification: overrideJustification,
              registry_principles: registry.principles || {},
              skill_registry: registry.skills.map((skill) => ({
                slash: skill.slash,
                category: skill.category,
                purpose: skill.purpose,
                inputs: skill.inputs,
                outputs: skill.outputs,
                upstream: skill.upstream,
                downstream: skill.downstream,
                mode: skill.mode,
                source_backed: skill.source_backed,
                legal_setting_scope: skill.legal_setting_scope,
                markdown_first: skill.markdown_first,
              })),
              direct_mece_violation_rule: "same category + same goal + same input contract + same output contract",
              user_gate_choices: ["Use or improve existing skill", "Create separate skill with reason"],
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "skill_router_decision",
            description: "MECE-aware routing decision for legal-workbench skill requests.",
            strict: true,
            schema,
          },
        },
      },
    });
  };
}
