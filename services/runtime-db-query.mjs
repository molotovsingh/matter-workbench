import { spawnSync } from "node:child_process";
import process from "node:process";

import { psqlConnectionArgs } from "../scripts/db-psql.mjs";
import { makeHttpError } from "../shared/safe-paths.mjs";
import { REDACTED_SECRET, redactSensitiveText } from "../shared/secret-redaction.mjs";
import { ensureRuntimeDbSafeRoleSql } from "./runtime-db-sql-safety.mjs";

export function queryRuntimeDbJson({
  databaseUrl = "",
  sql = "",
  spawn = spawnSync,
  maxBuffer,
  errorPrefix = "runtime DB query failed",
  noJsonMessage = "runtime DB query returned no JSON.",
  invalidJsonMessage = "runtime DB query returned invalid JSON.",
} = {}) {
  const { command, args, env } = psqlConnectionArgs(databaseUrl);
  const options = {
    input: ensureRuntimeDbSafeRoleSql(sql),
    encoding: "utf8",
    env: { ...process.env, ...env },
  };
  if (Number.isInteger(maxBuffer) && maxBuffer > 0) options.maxBuffer = maxBuffer;

  const result = spawn(command, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A"], options);
  if (result.error) {
    throw makeHttpError(`${errorPrefix}: ${redactRuntimeDbError(result.error.message)}`, 503);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw makeHttpError(`${errorPrefix}: ${redactRuntimeDbError(detail)}`, 503);
  }
  return parsePsqlJson(result.stdout || "", { noJsonMessage, invalidJsonMessage });
}

export function parsePsqlJson(stdout = "", {
  noJsonMessage = "runtime DB query returned no JSON.",
  invalidJsonMessage = "runtime DB query returned invalid JSON.",
} = {}) {
  const text = String(stdout || "").trim();
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (!starts.length) throw makeHttpError(noJsonMessage, 503);
  const start = Math.min(...starts);
  const objectEnd = text.lastIndexOf("}");
  const arrayEnd = text.lastIndexOf("]");
  const end = Math.max(objectEnd, arrayEnd);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw makeHttpError(invalidJsonMessage, 503);
  }
}

export function redactRuntimeDbError(value) {
  return redactSensitiveText(value)
    .replace(/(^|[^A-Za-z0-9_-])(?:top-secret|secret)(?=$|[^A-Za-z0-9_-])/gi, (_match, prefix) => `${prefix}${REDACTED_SECRET}`);
}
