export const SKILL_IDEA_SESSION_COMMAND_SETS = Object.freeze({
  edit: ["edit answers", "edit"],
  generateSample: ["generate sample", "generate sample from this matter", "use this matter for sample"],
  savedIdeaGenerateSample: ["generate sample", "use this matter for sample", "regenerate sample"],
  approveSample: ["looks useful", "looks right", "approve sample", "sample approved"],
  markReady: ["mark ready for review", "mark ready"],
  openSkills: ["open in skills", "open skills"],
});

const EDIT_COMMANDS = new Set(SKILL_IDEA_SESSION_COMMAND_SETS.edit);
const GENERATE_SAMPLE_COMMANDS = new Set(SKILL_IDEA_SESSION_COMMAND_SETS.generateSample);
const SAVED_IDEA_GENERATE_SAMPLE_COMMANDS = new Set(SKILL_IDEA_SESSION_COMMAND_SETS.savedIdeaGenerateSample);
const APPROVE_SAMPLE_COMMANDS = new Set(SKILL_IDEA_SESSION_COMMAND_SETS.approveSample);
const MARK_READY_COMMANDS = new Set(SKILL_IDEA_SESSION_COMMAND_SETS.markReady);
const OPEN_SKILLS_COMMANDS = new Set(SKILL_IDEA_SESSION_COMMAND_SETS.openSkills);

export function classifySkillIdeaSessionInput(input, {
  ready = false,
  hasSavedIdea = false,
  hasActiveSample = false,
  sampleApproved = false,
} = {}) {
  const normalized = normalizeSessionCommandInput(input);
  if (normalized === "cancel") return { action: "cancel" };
  if (!String(input || "").trim()) return { action: "blank" };
  if (!ready) return { action: "answer_question" };
  if (normalized === "save idea" || normalized === "save updates") return { action: "save" };

  const copySampleVersion = parseCopySampleVersion(normalized);
  if (copySampleVersion) return { action: "copy_sample_version", version: copySampleVersion };

  if (hasSavedIdea) {
    if (SAVED_IDEA_GENERATE_SAMPLE_COMMANDS.has(normalized)) {
      return {
        action: "generate_sample",
        feedback: normalized === "regenerate sample" ? "Regenerate the sample with the current design brief." : "",
      };
    }
    if (normalized === "copy sample") return { action: "copy_sample" };
    if (APPROVE_SAMPLE_COMMANDS.has(normalized)) return { action: "approve_sample" };
    if (normalized === "create skill") return { action: "create_skill" };
    if (normalized === "copy review packet") return { action: "copy_review_packet" };
    if (MARK_READY_COMMANDS.has(normalized)) return { action: "mark_ready" };
    if (OPEN_SKILLS_COMMANDS.has(normalized)) return { action: "open_skills" };
    if (normalized === "start another idea") return { action: "start_another" };
    if (EDIT_COMMANDS.has(normalized)) return { action: "edit_answers" };
    if (hasActiveSample && !sampleApproved) return { action: "sample_feedback", feedback: String(input || "").trim() };
  }

  if (EDIT_COMMANDS.has(normalized)) return { action: "edit_answers" };
  if (GENERATE_SAMPLE_COMMANDS.has(normalized)) return { action: "generate_sample", feedback: "" };
  return { action: "unknown" };
}

export function normalizeSessionCommandInput(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseCopySampleVersion(normalized) {
  const match = String(normalized || "").match(/^copy sample v(\d+)$/i);
  return match ? Number(match[1] || 0) : 0;
}
