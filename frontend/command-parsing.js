const SLASH_COMMANDS = new Set([
  "/matter-init",
  "/prepare_matter",
  "/extract",
  "/describe_sources",
  "/context_preview",
  "/context_search",
  "/create_listofdates",
  "/doctor",
]);

const PROVIDER_BACKED_COMMANDS = new Set([
  "/describe_sources",
  "/create_listofdates",
]);

const SLASH_COMMAND_SUGGESTIONS = [
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
    description: "Label sources with lawyer-readable names. Paid AI actions ask first.",
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
];

const COMMAND_ALIASES = new Map([
  ["prepare matter", "/prepare_matter"],
  ["prepare this matter", "/prepare_matter"],
  ["matter prep", "/prepare_matter"],
  ["setup matter", "/prepare_matter"],
  ["extract", "/extract"],
  ["describe sources", "/describe_sources"],
  ["source labels", "/describe_sources"],
  ["context", "/context_preview"],
  ["show context", "/context_preview"],
  ["list of dates", "/create_listofdates"],
  ["create list of dates", "/create_listofdates"],
  ["chronology", "/create_listofdates"],
  ["doctor", "/doctor"],
]);

const LANE_COMMANDS = new Map([
  ["open inbox", "00_Inbox"],
  ["open library", "10_Library"],
  ["show library", "10_Library"],
  ["open workshop", "20_Workshop"],
  ["open drafts", "30_Drafts"],
  ["show drafts", "30_Drafts"],
  ["open dispatch", "40_Dispatch"],
]);

const STATUS_ALIASES = new Set(["show status", "status"]);
const SKILLS_ALIASES = new Set(["open skills", "show skills", "skills"]);
const NEW_SKILL_MODE_ALIASES = new Set([
  "new skill",
  "create skill",
  "create a skill",
  "make skill",
  "make a skill",
  "design skill",
  "design a skill",
]);

export function parseDeterministicCommand(input) {
  const normalized = normalizeCommandInput(input);
  if (!normalized) return null;
  const searchCommand = parseSearchCommand(normalized);
  if (searchCommand) return searchCommand;
  if (STATUS_ALIASES.has(normalized)) return { type: "status" };
  if (SKILLS_ALIASES.has(normalized)) return { type: "skills", input: normalized };
  const lanePath = LANE_COMMANDS.get(normalized);
  if (lanePath) return { type: "lane", input: normalized, lanePath };
  if (SLASH_COMMANDS.has(normalized)) return { type: "skill", command: normalized };
  const aliasCommand = COMMAND_ALIASES.get(normalized);
  if (aliasCommand) return { type: "skill", command: aliasCommand };
  return null;
}

export function parseNewSkillModeCommand(input) {
  const normalized = normalizeCommandInput(input);
  if (!normalized) return null;
  if (!NEW_SKILL_MODE_ALIASES.has(normalized)) return null;
  return { type: "new_skill_mode", input: normalized };
}

export function listSlashCommandSuggestions(input, extraSuggestions = []) {
  const raw = String(input || "");
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed.startsWith("/")) return [];
  const combined = [...SLASH_COMMAND_SUGGESTIONS, ...extraSuggestions]
    .filter((suggestion) => suggestion?.command)
    .filter((suggestion, index, list) => list.findIndex((candidate) => candidate.command === suggestion.command) === index);
  return combined.filter((suggestion) => suggestion.command.startsWith(trimmed));
}

export function parseSkillIdeaInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const normalized = normalizeCommandInput(raw);
  const patterns = [
    /^create (?:a )?new skil{1,2} (?:for|to|that) (.+)$/,
    /^create (?:a )?skil{1,2} (?:for|to|that) (.+)$/,
    /^make (?:a )?new skil{1,2} (?:for|to|that) (.+)$/,
    /^make (?:a )?skil{1,2} (?:for|to|that) (.+)$/,
    /^new skil{1,2} (.+)$/,
    /^i need a skil{1,2} that (.+)$/,
    /^i want a (?:new )?skil{1,2} (?:for|to|that) (.+)$/,
    /^can we make a skil{1,2} for (.+)$/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]?.trim()) {
      return {
        type: "skill_idea",
        text: raw.replace(/\s+/g, " "),
        idea: match[1].trim(),
      };
    }
  }
  return null;
}

export function normalizeCommandInput(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function isProviderBackedCommand(command) {
  return PROVIDER_BACKED_COMMANDS.has(command);
}

function parseSearchCommand(normalized) {
  if (normalized === "search" || normalized === "find" || normalized === "/context_search") {
    return { type: "search", command: "/context_search", query: "" };
  }
  for (const prefix of ["search ", "find ", "/context_search "]) {
    if (normalized.startsWith(prefix)) {
      return {
        type: "search",
        command: "/context_search",
        query: normalized.slice(prefix.length).trim(),
      };
    }
  }
  return null;
}
