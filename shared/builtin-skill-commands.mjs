export const BUILTIN_SKILL_COMMANDS = Object.freeze([
  "/matter-init",
  "/prepare_matter",
  "/extract",
  "/describe_sources",
  "/context_preview",
  "/context_search",
  "/create_listofdates",
  "/doctor",
]);

export const PROVIDER_BACKED_BUILTIN_SKILL_COMMANDS = Object.freeze([
  "/describe_sources",
  "/create_listofdates",
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
    command: "/doctor",
    description: "Check known matter workspace issues.",
  },
]);

export const BUILTIN_SKILL_COMMAND_SET = new Set(BUILTIN_SKILL_COMMANDS);
export const PROVIDER_BACKED_BUILTIN_SKILL_COMMAND_SET = new Set(PROVIDER_BACKED_BUILTIN_SKILL_COMMANDS);
