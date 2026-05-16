import path from "node:path";
import { toPosix } from "../shared/safe-paths.mjs";

const MACHINE_JUNK_NAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
]);

const EXCLUDED_PATH_SEGMENTS = new Set([
  ".git",
  "node_modules",
]);

const SECRET_OR_LOG_EXTENSIONS = new Set([
  ".env",
  ".log",
  ".sqlite",
  ".db",
]);

export function toMatterContextPacketPath(value) {
  return toPosix(String(value || "").replace(/\\/g, "/"));
}

export function isExcludedMatterContextPath(value) {
  const normalized = toMatterContextPacketPath(value);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => EXCLUDED_PATH_SEGMENTS.has(segment))) return true;
  const basename = segments.at(-1) || "";
  if (!basename) return false;
  if (MACHINE_JUNK_NAMES.has(basename)) return true;
  if (basename.startsWith("~$")) return true;
  if (basename === ".env" || basename.startsWith(".env.")) return true;
  if (SECRET_OR_LOG_EXTENSIONS.has(path.extname(basename).toLowerCase())) return true;
  return false;
}
