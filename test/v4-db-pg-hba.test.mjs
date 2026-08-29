import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { renderV4PgHbaBlock, upsertV4PgHbaBlock } from "../scripts/v4-db-pg-hba.mjs";
import { installV4PgHba } from "../scripts/v4-db-pg-hba-install.mjs";

const ROLE = "mwb_v4_runtime";

test("V4 pg_hba block denies local and loopback access to host databases", () => {
  const block = renderV4PgHbaBlock({ runtimeRole: ROLE });
  for (const db of ["matter_workbench_runtime", "matter_workbench_mothership"]) {
    assert.match(block, new RegExp(`local\\s+${db}\\s+${ROLE}\\s+reject`));
    assert.match(block, new RegExp(`host\\s+${db}\\s+${ROLE}\\s+127\\.0\\.0\\.1/32\\s+reject`));
    assert.match(block, new RegExp(`host\\s+${db}\\s+${ROLE}\\s+::1/128\\s+reject`));
  }
});

test("upsert owns one marker block and preserves every other byte", () => {
  const original = "# existing\nlocal all all peer\nhost all all 127.0.0.1/32 scram-sha-256\n";
  const once = upsertV4PgHbaBlock(original, { runtimeRole: ROLE });
  assert.match(once, /# END MATTER WORKBENCH V4\n# existing\nlocal all all peer\n/, "existing bytes survive after the leading reject block");
  assert.equal(once.match(/BEGIN MATTER WORKBENCH V4/g)?.length, 1);
  const twice = upsertV4PgHbaBlock(once, { runtimeRole: ROLE });
  assert.equal(twice, once, "a second install is byte-identical");
});

test("upsert rejects malformed or duplicate marker ownership", () => {
  assert.throws(() => upsertV4PgHbaBlock("# BEGIN MATTER WORKBENCH V4\n", { runtimeRole: ROLE }), { code: "v4_db.pg_hba_marker_invalid" });
  const block = renderV4PgHbaBlock({ runtimeRole: ROLE });
  assert.throws(() => upsertV4PgHbaBlock(`${block}\n${block}`, { runtimeRole: ROLE }), { code: "v4_db.pg_hba_marker_invalid" });
});

test("privileged installer writes atomically, reloads and verifies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v4-hba-"));
  try {
    const file = path.join(root, "pg_hba.conf");
    await writeFile(file, "# existing\nlocal all all peer\n");
    const calls = [];
    const result = await installV4PgHba({
      file,
      runtimeRole: ROLE,
      assertPrivileged: () => {},
      reload: async () => { calls.push("reload"); },
      verify: async () => { calls.push("verify"); return true; },
    });
    assert.equal(result.changed, true);
    assert.deepEqual(calls, ["reload", "verify"]);
    assert.match(await readFile(file, "utf8"), /BEGIN MATTER WORKBENCH V4/);
    assert.match(await readFile(`${file}.mwb-v4.backup`, "utf8"), /^# existing/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("installer refuses missing privilege and rolls back failed verification", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v4-hba-"));
  try {
    const file = path.join(root, "pg_hba.conf");
    const original = "# existing\n";
    await writeFile(file, original);
    await assert.rejects(() => installV4PgHba({ file, runtimeRole: ROLE, assertPrivileged: () => { const e = new Error("no"); e.code = "v4_db.pg_hba_privilege_required"; throw e; } }), { code: "v4_db.pg_hba_privilege_required" });
    await assert.rejects(() => installV4PgHba({
      file, runtimeRole: ROLE, assertPrivileged: () => {}, reload: async () => {}, verify: async () => false,
    }), { code: "v4_db.pg_hba_verification_failed" });
    assert.equal(await readFile(file, "utf8"), original, "verification failure restores the original file");
  } finally { await rm(root, { recursive: true, force: true }); }
});
