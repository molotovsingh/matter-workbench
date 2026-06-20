export const BUILTIN_SKILL_COMMANDS = Object.freeze([
  "/matter-init",
  "/prepare_matter",
  "/extract",
  "/describe_sources",
  "/context_preview",
  "/context_search",
  "/create_listofdates",
  "/the_story",
  "/doctor",
]);

export const PROVIDER_BACKED_BUILTIN_SKILL_COMMANDS = Object.freeze([
  "/describe_sources",
  "/create_listofdates",
  "/the_story",
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
    description: "Create Source Labels / Document Index for List of Dates. Paid AI actions ask first.",
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
    command: "/create_listofdates",
    description: "Create the lawyer-facing list of dates. Paid AI actions ask first.",
  },
  {
    command: "/the_story",
    description: "Write the Matter Story from the current List of Dates. Paid AI actions ask first.",
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
  ["list of dates", "/create_listofdates"],
  ["create list of dates", "/create_listofdates"],
  ["chronology", "/create_listofdates"],
  ["the story", "/the_story"],
  ["matter story", "/the_story"],
  ["write matter story", "/the_story"],
  ["doctor", "/doctor"],
  ["check matter health", "/doctor"],
]);

export const BUILTIN_SKILL_COMMAND_SET = new Set(BUILTIN_SKILL_COMMANDS);
export const BUILTIN_SKILL_COMMAND_ALIAS_MAP = new Map(BUILTIN_SKILL_COMMAND_ALIASES);
export const PROVIDER_BACKED_BUILTIN_SKILL_COMMAND_SET = new Set(PROVIDER_BACKED_BUILTIN_SKILL_COMMANDS);
