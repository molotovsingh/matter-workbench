import { createHash } from "node:crypto";

import { redactSensitiveText } from "../shared/secret-redaction.mjs";

export const V4_DATABASE_NAME = "matter_workbench_v4";
export const V4_POOL_MAX = 16;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;

export function assertSafeV4DatabaseName(value) {
  const name = String(value || "").trim();
  if (name !== V4_DATABASE_NAME) throw configError("V4 database must be matter_workbench_v4", "v4_db.database_invalid");
  return name;
}

export function assertSafeRole(value) {
  const role = String(value || "").trim();
  if (!ROLE.test(role)) throw configError("V4 role must be a lowercase PostgreSQL identifier", "v4_db.role_invalid");
  return role;
}

export function assertV4DatabaseUrl(value, field) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw configError(`${field} must be a PostgreSQL URL`, "v4_db.url_invalid"); }
  if (!/^postgres(?:ql)?:$/.test(url.protocol)) throw configError(`${field} must be a PostgreSQL URL`, "v4_db.url_invalid");
  assertSafeV4DatabaseName(decodeURIComponent(url.pathname.replace(/^\//, "")));
  return url.toString();
}

export function loadV4DatabaseOperatorConfig(env = process.env) {
  const databaseName = assertSafeV4DatabaseName(env.MWB_V4_DB_NAME || V4_DATABASE_NAME);
  const migrationRole = assertSafeRole(env.MWB_V4_MIGRATION_ROLE);
  const runtimeRole = assertSafeRole(env.MWB_V4_RUNTIME_ROLE);
  if (migrationRole === runtimeRole) throw configError("migration and runtime identities must be distinct", "v4_db.identities_not_distinct");
  const migrationUrl = assertV4DatabaseUrl(env.MWB_V4_MIGRATION_URL, "MWB_V4_MIGRATION_URL");
  const runtimeUrl = assertV4DatabaseUrl(env.MWB_V4_DB_URL, "MWB_V4_DB_URL");
  const adminUrl = postgresUrl(env.MWB_V4_ADMIN_URL, "MWB_V4_ADMIN_URL");
  if (new URL(migrationUrl).username !== migrationRole || new URL(runtimeUrl).username !== runtimeRole) {
    throw configError("V4 URL usernames must match their configured roles", "v4_db.url_role_mismatch");
  }
  const poolMaximum = Number(env.MWB_V4_DB_POOL_MAX);
  if (poolMaximum !== V4_POOL_MAX) throw configError("MWB_V4_DB_POOL_MAX must be 16", "v4_db.pool_max_invalid");
  if (String(env.MWB_V4_AUTO_MIGRATE) !== "0") throw configError("MWB_V4_AUTO_MIGRATE must be 0", "v4_db.auto_migrate_invalid");
  return { databaseName, migrationRole, runtimeRole, migrationUrl, runtimeUrl, adminUrl, poolMaximum, autoMigrate: false };
}

export function postureFingerprint(input = {}) {
  const posture = {
    databaseName: String(input.databaseName || ""),
    databaseHost: String(input.databaseHost || ""),
    migrationRole: String(input.migrationRole || ""),
    runtimeRole: String(input.runtimeRole || ""),
    poolMaximum: Number(input.poolMaximum || 0),
    autoMigrate: Boolean(input.autoMigrate),
    migrations: Array.isArray(input.migrations)
      ? input.migrations.map((m) => ({ name: String(m.name || ""), sha256: String(m.sha256 || "") })).sort((a, b) => a.name.localeCompare(b.name))
      : [],
    backupPolicy: String(input.backupPolicy || ""),
  };
  return createHash("sha256").update(JSON.stringify(posture)).digest("hex");
}

export function redactV4DatabaseText(value) {
  return redactSensitiveText(String(value || ""))
    .replace(/(postgres(?:ql)?:\/\/[^:@/\s]+):[^@/\s]+@/gi, "$1:***@")
    .replace(/\b(token|password)=([^\s]+)/gi, "$1=***");
}

export function configError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function postgresUrl(value, field) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw configError(`${field} must be a PostgreSQL URL`, "v4_db.url_invalid"); }
  if (!/^postgres(?:ql)?:$/.test(url.protocol)) throw configError(`${field} must be a PostgreSQL URL`, "v4_db.url_invalid");
  return url.toString();
}
