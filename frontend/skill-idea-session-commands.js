import { normalizeCommandInput } from "./command-parsing.js";

const EDIT_COMMANDS = new Set(["edit answers", "edit"]);
const GENERATE_SAMPLE_COMMANDS = new Set(["generate sample", "generate sample from this matter", "use this matter for sample"]);
const SAVED_IDEA_GENERATE_SAMPLE_COMMANDS = new Set(["generate sample", "use this matter for sample", "regenerate sample"]);
const APPROVE_SAMPLE_COMMANDS = new Set(["looks right", "approve sample", "sample approved"]);
const MARK_READY_COMMANDS = new Set(["mark ready for review", "mark ready"]);
const OPEN_SKILLS_COMMANDS = new Set(["open in skills", "open skills"]);

export function classifySkillIdeaSessionInput(input, {
  ready = false,
  hasSavedIdea = false,
  hasActiveSample = false,
  sampleApproved = false,
} = {}) {
  const normalized = normalizeCommandInput(input);
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

function parseCopySampleVersion(normalized) {
  const match = String(normalized || "").match(/^copy sample v(\d+)$/i);
  return match ? Number(match[1] || 0) : 0;
}
