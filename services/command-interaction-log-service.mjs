import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";

export const COMMAND_INTERACTION_LOG_SCHEMA_VERSION = "command-interaction-log/v1";

const MAX_TEXT_LENGTH = 1200;
const MAX_TERMINAL_LINES = 8;

export function createCommandInteractionLogService({
  appDir,
  logPath,
  now = () => new Date(),
} = {}) {
  const root = path.resolve(appDir || process.cwd());
  const storePath = logPath || path.join(root, ".local", "command-interactions.jsonl");
  let appendQueue = Promise.resolve();

  async function appendInteraction(entry = {}) {
    const record = normalizeInteraction(entry, { now });
    const result = {
      schema_version: COMMAND_INTERACTION_LOG_SCHEMA_VERSION,
      logged: true,
      path: toPosix(path.relative(root, storePath)),
      timestamp: record.timestamp,
    };
    const write = appendQueue.then(async () => {
      await mkdir(path.dirname(storePath), { recursive: true });
      await appendFile(storePath, `${JSON.stringify(record)}\n`, "utf8");
    });
    appendQueue = write.catch(() => {});
    await write;
    return result;
  }

  return {
    appendInteraction,
    logPath: storePath,
  };
}

export function normalizeInteraction(entry = {}, { now = () => new Date() } = {}) {
  return {
    schema_version: COMMAND_INTERACTION_LOG_SCHEMA_VERSION,
    timestamp: normalizeTimestamp(entry.timestamp, now),
    matter: normalizeMatter(entry.matter),
    typed_input: truncate(entry.typed_input ?? entry.typedInput),
    matched_command: truncate(entry.matched_command ?? entry.matchedCommand, 240),
    rendered_state: truncate(entry.rendered_state ?? entry.renderedState, 240),
    status: truncate(entry.status, 240),
    skill_idea_id: truncate(entry.skill_idea_id ?? entry.skillIdeaId, 240),
    router_decision: normalizeRouterDecision(entry.router_decision ?? entry.routerDecision),
    provider_run_invoked: Boolean(entry.provider_run_invoked ?? entry.providerRunInvoked),
    planner_source: truncate(entry.planner_source ?? entry.plannerSource, 240),
    planner_model: truncate(entry.planner_model ?? entry.plannerModel, 240),
    planner_fallback_reason: truncate(entry.planner_fallback_reason ?? entry.plannerFallbackReason, 800),
    errors: normalizeErrors(entry.errors ?? entry.error),
    status_bar: truncate(entry.status_bar ?? entry.statusBar, 240),
    terminal_lines: normalizeTerminalLines(entry.terminal_lines ?? entry.terminalLines),
  };
}

function normalizeTimestamp(value, now) {
  const timestamp = String(value || "").trim();
  if (timestamp) return timestamp;
  return now().toISOString();
}

function normalizeMatter(matter) {
  if (!matter || typeof matter !== "object") {
    return {
      matter_name: "",
      folder_name: "",
    };
  }
  return {
    matter_name: truncate(matter.matter_name ?? matter.matterName, 240),
    folder_name: truncate(matter.folder_name ?? matter.folderName, 240),
  };
}

function normalizeRouterDecision(decision) {
  if (!decision || typeof decision !== "object") {
    if (typeof decision === "string") {
      return {
        decision: truncate(decision, 240),
        matched_skill: "",
        confidence: null,
        recommended_action: "",
        reason: "",
      };
    }
    return null;
  }
  const confidence = Number(decision.confidence);
  return {
    decision: truncate(decision.decision, 240),
    matched_skill: truncate(decision.matched_skill ?? decision.matchedSkill, 240),
    confidence: Number.isFinite(confidence) ? confidence : null,
    recommended_action: truncate(decision.recommended_action ?? decision.recommendedAction, 400),
    reason: truncate(decision.reason, 800),
  };
}

function normalizeErrors(errors) {
  const values = Array.isArray(errors) ? errors : errors ? [errors] : [];
  return values
    .map((error) => truncate(error?.message || error, 800))
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeTerminalLines(lines) {
  const values = Array.isArray(lines) ? lines : lines ? [lines] : [];
  return values
    .map((line) => truncate(line, 800))
    .filter(Boolean)
    .slice(-MAX_TERMINAL_LINES);
}

function truncate(value, maxLength = MAX_TEXT_LENGTH) {
  const text = redactSecrets(String(value || "").trim());
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function toPosix(value) {
  return String(value || "").split(path.sep).join("/");
}

function redactSecrets(value) {
  return redactSensitiveText(value);
}
