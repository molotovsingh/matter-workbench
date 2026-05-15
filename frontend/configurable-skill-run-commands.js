import { normalizeCommandInput } from "./command-parsing.js";
import { isConfigurableSkillOutputReplacementCommand } from "./configurable-skill-commands.js";

const KEEP_OR_CANCEL_COMMANDS = new Set([
  "cancel",
  "keep current",
  "keep existing document",
  "keep existing output",
]);

const RUN_ACCEPTANCE_COMMANDS = new Set([
  "looks good",
  "good",
  "run looks good",
]);

const IMPROVEMENT_COMMANDS = new Set([
  "improve",
  "improve this skill",
  "revise",
  "revise this skill",
]);

export function classifyConfigurableSkillRunInput(input, { phase = "overwrite" } = {}) {
  const normalized = normalizeCommandInput(input);
  const pendingPhase = phase || "overwrite";

  if (pendingPhase === "improve") {
    return normalized === "cancel" ? "cancel_improvement" : "save_improvement";
  }
  if (normalized === "open output") return "open_output";
  if (RUN_ACCEPTANCE_COMMANDS.has(normalized)) return "accept_run";
  if (IMPROVEMENT_COMMANDS.has(normalized)) return "improve_skill";
  if (pendingPhase === "action_sheet" && isConfigurableSkillOutputReplacementCommand(normalized)) {
    return "show_overwrite_prompt";
  }
  if (pendingPhase === "action_sheet" && KEEP_OR_CANCEL_COMMANDS.has(normalized)) {
    return "clear_action_sheet";
  }
  if (KEEP_OR_CANCEL_COMMANDS.has(normalized)) return "cancel_overwrite";
  if (isConfigurableSkillOutputReplacementCommand(normalized)) return "replace_output";
  return "";
}
