import path from "node:path";
import { toPosix } from "../shared/safe-paths.mjs";

const DEFAULT_COMMAND_LOG_LIMIT = 200;
const DEFAULT_COMMAND_FAILURE_LIMIT = 10;

export async function buildCommandFailureAttentionItems({
  commandInteractionLogService,
  matterName,
  commandLogLimit = DEFAULT_COMMAND_LOG_LIMIT,
  commandFailureLimit = DEFAULT_COMMAND_FAILURE_LIMIT,
} = {}) {
  if (typeof commandInteractionLogService?.readRecentInteractions !== "function") {
    return [];
  }
  const interactions = await commandInteractionLogService.readRecentInteractions({ limit: commandLogLimit });
  const failureKeys = new Set();
  const items = [];
  const matterInteractions = interactions
    .filter((entry) => commandBelongsToMatter(entry, matterName))
    .filter(isCommandFailure)
    .slice(-commandFailureLimit)
    .reverse();

  for (const entry of matterInteractions) {
    const detail = commandFailureDetail(entry);
    const failureKey = [
      entry.matched_command || entry.typed_input || "unknown command",
      detail,
    ].join("\n");
    if (failureKeys.has(failureKey)) continue;
    failureKeys.add(failureKey);
    items.push({
      severity: "warning",
      category: "command",
      code: "command_failed",
      title: `Command failed: ${entry.matched_command || entry.typed_input || "unknown command"}`,
      detail,
      action: "Use the command interaction log to reproduce the route/UI failure.",
      evidence: [commandLogEvidence(commandInteractionLogService)],
      occurredAt: entry.timestamp || "",
    });
  }
  return items;
}

function commandLogEvidence(logService) {
  const logPath = logService.logPath;
  if (!logPath) return { path: "command-interactions.jsonl" };
  return { path: toPosix(path.relative(path.dirname(path.dirname(logPath)), logPath)) };
}

function commandBelongsToMatter(entry, matterName) {
  const matter = entry?.matter || {};
  return normalizeText(matter.folder_name || matter.folderName) === matterName
    || normalizeText(matter.matter_name || matter.matterName) === matterName;
}

function isCommandFailure(entry) {
  if (!entry || typeof entry !== "object") return false;
  const status = normalizeText(entry.status);
  if (status === "failed") return true;
  if (Array.isArray(entry.errors) && entry.errors.length) return true;
  if (["ran", "complete", "completed", "succeeded", "cancelled", "router_checked"].includes(status)) return false;
  const searchable = [
    entry.status_bar,
    ...(Array.isArray(entry.terminal_lines) ? entry.terminal_lines : []),
  ].map(normalizeText).join("\n");
  return /\b(failed|error|unavailable)\b/i.test(searchable);
}

function commandFailureDetail(entry) {
  const errors = Array.isArray(entry.errors) ? entry.errors.filter(Boolean) : [];
  if (errors.length) return errors.join("; ");
  return normalizeText(entry.status_bar || entry.terminal_lines?.at?.(-1) || "Command log indicates a failure.");
}

function normalizeText(value, maxLength = 800) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}
