export function runtimeDbSafeRoleGuardSql() {
  return [
    "do $mwb_runtime_role_guard$",
    "begin",
    "  if exists (",
    "    select 1",
    "    from pg_roles",
    "    where rolname = current_user",
    "      and (rolsuper or rolbypassrls)",
    "  ) then",
    "    raise exception 'Matter Workbench runtime DB role must not be superuser or BYPASSRLS';",
    "  end if;",
    "end",
    "$mwb_runtime_role_guard$;",
  ].join("\n");
}

export function ensureRuntimeDbSafeRoleSql(sql = "") {
  const text = String(sql || "").trim();
  if (!text) return runtimeDbSafeRoleGuardSql();
  if (/mwb_runtime_role_guard/i.test(text)) return `${text}\n`;
  return `${runtimeDbSafeRoleGuardSql()}\n${text}\n`;
}

export function wrapRuntimeDbWriteTransaction(sql = "") {
  const text = String(sql || "").trim();
  return [
    "begin;",
    runtimeDbSafeRoleGuardSql(),
    text,
    "commit;",
    "",
  ].join("\n");
}
