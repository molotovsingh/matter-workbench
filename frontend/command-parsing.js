import {
  BUILTIN_SKILL_COMMAND_ALIAS_MAP,
  BUILTIN_SKILL_COMMAND_SET,
  BUILTIN_SKILL_SUGGESTIONS,
  PROVIDER_BACKED_BUILTIN_SKILL_COMMAND_SET,
} from "../shared/builtin-skill-commands.mjs";
import { parseSkillIdeaInput as parseSharedSkillIdeaInput } from "../shared/skill-idea-input.mjs";

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
  if (BUILTIN_SKILL_COMMAND_SET.has(normalized)) return { type: "skill", command: normalized };
  const aliasCommand = BUILTIN_SKILL_COMMAND_ALIAS_MAP.get(normalized);
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
  const combined = [...BUILTIN_SKILL_SUGGESTIONS, ...extraSuggestions]
    .filter((suggestion) => suggestion?.command)
    .filter((suggestion, index, list) => list.findIndex((candidate) => candidate.command === suggestion.command) === index);
  return combined.filter((suggestion) => suggestion.command.startsWith(trimmed));
}

export function parseSkillIdeaInput(input) {
  return parseSharedSkillIdeaInput(input);
}

export function normalizeCommandInput(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function isProviderBackedCommand(command) {
  return PROVIDER_BACKED_BUILTIN_SKILL_COMMAND_SET.has(command);
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
