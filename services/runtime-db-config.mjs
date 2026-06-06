export function runtimeDatabaseUrl(env = {}) {
  return String(env.MWB_RUNTIME_DATABASE_URL || env.MWB_DATABASE_URL || env.DATABASE_URL || "").trim();
}

export function runtimeDatabaseUrlSource(env = {}) {
  if (String(env.MWB_RUNTIME_DATABASE_URL || "").trim()) return "MWB_RUNTIME_DATABASE_URL";
  if (String(env.MWB_DATABASE_URL || "").trim()) return "MWB_DATABASE_URL";
  if (String(env.DATABASE_URL || "").trim()) return "DATABASE_URL";
  return "";
}
