import { toPosix } from "../shared/safe-paths.mjs";

const HIDDEN_ROOT_ENTRIES = new Set([
  ".git",
  ".playwright-cli",
  "phase1_legal_workbench",
]);

export function toWorkspacePath(value) {
  return toPosix(String(value || "").replace(/\\/g, "/"));
}

export function isBlockedWorkspacePath(value) {
  const normalized = toWorkspacePath(value);
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) return false;
  if (HIDDEN_ROOT_ENTRIES.has(segments[0])) return true;
  if (segments.some((segment) => segment.startsWith("."))) return true;
  if (segments.some((segment) => segment === "node_modules")) return true;
  const basename = segments.at(-1) || "";
  if (basename.startsWith("~$")) return true;
  return false;
}
