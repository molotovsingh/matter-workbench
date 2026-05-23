import { SKILL_IDEA_STATUS } from "./skill-idea-statuses.mjs";

export const SKILL_IDEA_DESIGN_BRIEF_FIELDS = Object.freeze([
  "intendedUser",
  "problem",
  "expectedInputs",
  "expectedOutputArtifact",
  "targetLane",
  "paidPosture",
  "riskLevel",
  "notes",
]);

export const SKILL_IDEA_TARGET_LANE_VALUES = Object.freeze([
  "10_Library",
  "20_Workshop",
  "30_Drafts",
  "40_Dispatch",
]);

export const SKILL_IDEA_PAID_POSTURE_VALUES = Object.freeze([
  "free",
  "paid",
  "unknown",
]);

export const SKILL_IDEA_RISK_LEVEL_VALUES = Object.freeze([
  "low",
  "medium",
  "high",
]);

export const SKILL_IDEA_TARGET_LANES = new Set(["", ...SKILL_IDEA_TARGET_LANE_VALUES]);
export const SKILL_IDEA_PAID_POSTURES = new Set(["", ...SKILL_IDEA_PAID_POSTURE_VALUES]);
export const SKILL_IDEA_RISK_LEVELS = new Set(["", ...SKILL_IDEA_RISK_LEVEL_VALUES]);

export const EMPTY_SKILL_IDEA_DESIGN_BRIEF = Object.freeze({
  intendedUser: "",
  problem: "",
  expectedInputs: "",
  expectedOutputArtifact: "",
  targetLane: "",
  paidPosture: "",
  riskLevel: "",
  notes: "",
});

export const DEFAULT_SKILL_IDEA_DESIGN_BRIEF = Object.freeze({
  intendedUser: "Lawyer",
  expectedInputs: "Selected matter documents and source labels",
  expectedOutputArtifact: "Internal matter review note",
  targetLane: "20_Workshop",
  paidPosture: "paid",
  riskLevel: "medium",
  notes: "No extra format rules supplied.",
});

export const SKILL_IDEA_READINESS_CHECKS = Object.freeze([
  Object.freeze(["intendedUser", "Intended user present"]),
  Object.freeze(["problem", "Problem/job present"]),
  Object.freeze(["expectedInputs", "Expected inputs present"]),
  Object.freeze(["expectedOutputArtifact", "Expected output artifact present"]),
  Object.freeze(["targetLane", "Target lane selected"]),
  Object.freeze(["paidPosture", "Paid/free posture selected"]),
  Object.freeze(["riskLevel", "Risk level selected"]),
  Object.freeze(["notes", "Notes or acceptance criteria present"]),
]);

const MAX_BRIEF_TEXT_LENGTH = 4000;

export function sanitizeSkillIdeaDesignBrief(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    intendedUser: stringOrEmpty(source.intendedUser),
    problem: stringOrEmpty(source.problem),
    expectedInputs: stringOrEmpty(source.expectedInputs),
    expectedOutputArtifact: stringOrEmpty(source.expectedOutputArtifact),
    targetLane: stringOrEmpty(source.targetLane),
    paidPosture: stringOrEmpty(source.paidPosture),
    riskLevel: stringOrEmpty(source.riskLevel),
    notes: stringOrEmpty(source.notes),
  };
}

export function normalizeSkillIdeaDesignBrief(designBrief, {
  maxTextLength = MAX_BRIEF_TEXT_LENGTH,
  makeError = defaultMakeError,
} = {}) {
  const source = designBrief && typeof designBrief === "object" ? designBrief : {};
  const targetLane = normalizeBriefEnum(source.targetLane, SKILL_IDEA_TARGET_LANES, "target lane", makeError);
  const paidPosture = normalizeBriefEnum(source.paidPosture, SKILL_IDEA_PAID_POSTURES, "paid/free posture", makeError);
  const riskLevel = normalizeBriefEnum(source.riskLevel, SKILL_IDEA_RISK_LEVELS, "risk level", makeError);
  return {
    ...EMPTY_SKILL_IDEA_DESIGN_BRIEF,
    intendedUser: normalizeBriefText(source.intendedUser, "intended user", maxTextLength, makeError),
    problem: normalizeBriefText(source.problem, "problem", maxTextLength, makeError),
    expectedInputs: normalizeBriefText(source.expectedInputs, "expected inputs", maxTextLength, makeError),
    expectedOutputArtifact: normalizeBriefText(source.expectedOutputArtifact, "expected output artifact", maxTextLength, makeError),
    targetLane,
    paidPosture,
    riskLevel,
    notes: normalizeBriefText(source.notes, "notes", maxTextLength, makeError),
  };
}

export function calculateSkillIdeaReadiness(designBrief = {}) {
  const normalized = normalizeSkillIdeaDesignBrief(designBrief);
  const items = SKILL_IDEA_READINESS_CHECKS.map(([key, label]) => ({
    key,
    label,
    passed: Boolean(normalized[key]),
  }));
  const ready = items.every((item) => item.passed);
  return {
    state: ready ? SKILL_IDEA_STATUS.READY_FOR_REVIEW : SKILL_IDEA_STATUS.INCOMPLETE,
    ready,
    passedCount: items.filter((item) => item.passed).length,
    totalCount: items.length,
    items,
  };
}

function normalizeBriefText(value, label, maxTextLength, makeError) {
  const normalized = stringOrEmpty(value);
  if (normalized.length > maxTextLength) {
    throw makeError(`Skill idea design brief ${label} must be ${maxTextLength} characters or less`, 400);
  }
  return normalized;
}

function normalizeBriefEnum(value, allowed, label, makeError) {
  const normalized = stringOrEmpty(value);
  if (!allowed.has(normalized)) {
    throw makeError(`Invalid skill idea design brief ${label}: ${normalized || "blank"}`, 400);
  }
  return normalized;
}

function stringOrEmpty(value) {
  return String(value || "").trim();
}

function defaultMakeError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
