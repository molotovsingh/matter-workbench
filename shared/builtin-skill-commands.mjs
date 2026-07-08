import {
  CASE_TIMELINE_SKILL_SLASH,
  LEGACY_LIST_OF_DATES_SKILL_SLASH,
} from "./case-timeline-operation.mjs";

export const BUILTIN_SKILL_REGISTRY_COMMANDS = Object.freeze([
  "/matter-init",
  "/prepare_matter",
  "/extract",
  "/describe_sources",
  "/context_preview",
  "/context_search",
  CASE_TIMELINE_SKILL_SLASH,
  "/the_story",
  "/procedural_posture_diagnosis",
  "/doctor",
]);

export const LEGACY_BUILTIN_SKILL_COMMANDS = Object.freeze([
  LEGACY_LIST_OF_DATES_SKILL_SLASH,
]);

export const BUILTIN_SKILL_COMMANDS = Object.freeze([
  ...BUILTIN_SKILL_REGISTRY_COMMANDS,
  ...LEGACY_BUILTIN_SKILL_COMMANDS,
]);

export const PROVIDER_BACKED_BUILTIN_SKILL_COMMANDS = Object.freeze([
  "/describe_sources",
  CASE_TIMELINE_SKILL_SLASH,
  LEGACY_LIST_OF_DATES_SKILL_SLASH,
  "/the_story",
  "/procedural_posture_diagnosis",
]);

export const BUILTIN_SKILL_SUGGESTIONS = Object.freeze([
  {
    command: "/matter-init",
    description: "Set up the matter folders and file register.",
  },
  {
    command: "/prepare_matter",
    description: "Show a guarded preparation plan and skip stages that are already current.",
  },
  {
    command: "/extract",
    description: "Extract text and OCR-ready records from registered files.",
  },
  {
    command: "/describe_sources",
    description: "Create Source Labels / Document Index for the Case Timeline. Paid AI actions ask first.",
  },
  {
    command: "/context_preview",
    description: "Preview the bounded evidence packet for future Q&A/search. No provider call.",
  },
  {
    command: "/context_search",
    description: "Search the bounded matter context locally. No provider call.",
  },
  {
    command: CASE_TIMELINE_SKILL_SLASH,
    description: "Build the neutral Case Timeline. Paid AI actions ask first.",
  },
  {
    command: "/the_story",
    description: "Write the Matter Story from the current Case Timeline. Paid AI actions ask first.",
  },
  {
    command: "/procedural_posture_diagnosis",
    description: "Create the provisional Filing and Procedural Posture Diagnosis. Paid AI actions ask first.",
  },
  {
    command: "/doctor",
    description: "Check known matter workspace issues.",
  },
]);

export const BUILTIN_SKILL_COMMAND_ALIASES = Object.freeze([
  ["prepare matter", "/prepare_matter"],
  ["prepare this matter", "/prepare_matter"],
  ["matter prep", "/prepare_matter"],
  ["setup matter", "/matter-init"],
  ["set up matter", "/matter-init"],
  ["extract", "/extract"],
  ["describe sources", "/describe_sources"],
  ["source labels", "/describe_sources"],
  ["context", "/context_preview"],
  ["show context", "/context_preview"],
  ["preview matter context", "/context_preview"],
  ["find in matter", "/context_search"],
  ["case timeline", CASE_TIMELINE_SKILL_SLASH],
  ["build case timeline", CASE_TIMELINE_SKILL_SLASH],
  ["list of dates", CASE_TIMELINE_SKILL_SLASH],
  ["create list of dates", CASE_TIMELINE_SKILL_SLASH],
  ["chronology", CASE_TIMELINE_SKILL_SLASH],
  ["the story", "/the_story"],
  ["matter story", "/the_story"],
  ["write matter story", "/the_story"],
  ["procedural posture", "/procedural_posture_diagnosis"],
  ["diagnose procedural posture", "/procedural_posture_diagnosis"],
  ["filing and procedural posture", "/procedural_posture_diagnosis"],
  ["posture diagnosis", "/procedural_posture_diagnosis"],
  ["doctor", "/doctor"],
  ["check matter health", "/doctor"],
]);

export const BUILTIN_SKILL_COMMAND_SET = new Set(BUILTIN_SKILL_COMMANDS);
export const BUILTIN_SKILL_COMMAND_ALIAS_MAP = new Map(BUILTIN_SKILL_COMMAND_ALIASES);
export const PROVIDER_BACKED_BUILTIN_SKILL_COMMAND_SET = new Set(PROVIDER_BACKED_BUILTIN_SKILL_COMMANDS);
