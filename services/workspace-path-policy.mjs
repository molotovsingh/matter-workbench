import { toPosix } from "../shared/safe-paths.mjs";

const HIDDEN_ROOT_ENTRIES = new Set([
  ".git",
  ".playwright-cli",
  "phase1_legal_workbench",
]);

const OPERATOR_ONLY_ROOT_ENTRIES = new Set([
  "01_Admin",
  "02_Extracts",
  "99_Debug",
]);

const OPERATOR_ONLY_BASENAMES = new Set([
  "Extraction Log.csv",
  "File Register.csv",
  "Intake Log.csv",
  "Source Index.json",
  "Case Timeline.json",
  "Case Timeline.csv",
  "List of Dates.json",
  "List of Dates.csv",
]);

const GENERATED_ARTIFACT_LANES = new Set([
  "10_Library",
  "20_Workshop",
  "30_Drafts",
  "40_Dispatch",
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

export function isOperatorOnlyWorkspacePath(value) {
  const normalized = toWorkspacePath(value);
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) return false;
  if (segments[0] === "matter.json") return true;
  if (OPERATOR_ONLY_ROOT_ENTRIES.has(segments[0])) return true;

  const basename = segments.at(-1) || "";
  if (OPERATOR_ONLY_BASENAMES.has(basename)) return true;

  const firstSegment = segments[0] || "";
  if (GENERATED_ARTIFACT_LANES.has(firstSegment) && /\.(json|csv|log)$/i.test(basename)) return true;

  return false;
}

export function filterWorkspaceTreeForOperatorVisibility(tree, { canSeeOperatorFiles = false } = {}) {
  if (canSeeOperatorFiles || !tree || typeof tree !== "object") return tree;
  const filtered = filterWorkspaceNode(tree);
  return filtered || { ...tree, children: [] };
}

function filterWorkspaceNode(node) {
  if (!node || typeof node !== "object") return null;
  if (node.path && isOperatorOnlyWorkspacePath(node.path)) return null;

  const children = Array.isArray(node.children)
    ? node.children.map(filterWorkspaceNode).filter(Boolean)
    : undefined;

  if (node.kind === "directory" && node.path && children && children.length === 0) return null;

  return children ? { ...node, children } : { ...node };
}
