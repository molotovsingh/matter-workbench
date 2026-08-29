import { assertSafeRole, configError } from "./v4-db-operator-config.mjs";

export const V4_PG_HBA_BEGIN = "# BEGIN MATTER WORKBENCH V4";
export const V4_PG_HBA_END = "# END MATTER WORKBENCH V4";

export function renderV4PgHbaBlock({ runtimeRole } = {}) {
  const role = assertSafeRole(runtimeRole);
  const lines = [V4_PG_HBA_BEGIN];
  for (const database of ["matter_workbench_runtime", "matter_workbench_mothership"]) {
    lines.push(`local ${database} ${role} reject`);
    lines.push(`host ${database} ${role} 127.0.0.1/32 reject`);
    lines.push(`host ${database} ${role} ::1/128 reject`);
  }
  lines.push(V4_PG_HBA_END);
  return `${lines.join("\n")}\n`;
}

export function upsertV4PgHbaBlock(source, options = {}) {
  const input = String(source ?? "");
  const begin = occurrences(input, V4_PG_HBA_BEGIN);
  const end = occurrences(input, V4_PG_HBA_END);
  if (begin !== end || begin > 1) throw configError("V4 pg_hba marker block is malformed", "v4_db.pg_hba_marker_invalid");
  const block = renderV4PgHbaBlock(options);
  if (!begin) {
    // pg_hba is first-match. The reject rules MUST precede general allow rules;
    // appending them makes them decorative rather than effective.
    return `${block}${input}`;
  }
  const start = input.indexOf(V4_PG_HBA_BEGIN);
  const finish = input.indexOf(V4_PG_HBA_END, start) + V4_PG_HBA_END.length;
  const after = input[finish] === "\n" ? finish + 1 : finish;
  return `${input.slice(0, start)}${block}${input.slice(after)}`;
}

function occurrences(value, needle) {
  return value.split(needle).length - 1;
}
