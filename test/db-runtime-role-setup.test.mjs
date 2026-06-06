import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildRuntimeRoleSetupSql,
  renderRuntimeRoleSetupReport,
  runtimeUrlForRole,
  setupRuntimeDbRole,
} from "../scripts/db-runtime-role-setup.mjs";

test("runtime DB role setup SQL creates a non-superuser non-bypassrls role with table grants", () => {
  const sql = buildRuntimeRoleSetupSql({ roleName: "mwb_runtime_app", password: "secret" });
  assert.match(sql, /create role "mwb_runtime_app" login password 'secret'/);
  assert.match(sql, /alter role "mwb_runtime_app" nosuperuser nocreatedb nocreaterole noinherit nobypassrls/);
  assert.match(sql, /grant usage on schema public to "mwb_runtime_app"/);
  assert.match(sql, /grant select, insert, update, delete on all tables in schema public to "mwb_runtime_app"/);
  assert.match(sql, /grant execute on all functions in schema public to "mwb_runtime_app"/);
});

test("runtime DB role setup writes the dedicated runtime URL to ignored shadow env when requested", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-role-setup-"));
  await writeFile(path.join(tmp, ".env.shadow"), "MWB_DATABASE_URL=postgres://admin:admin-secret@db.example/mwb\n");
  const originalArgv = process.argv;
  process.argv = ["node", "script", "--write-env-shadow"];
  try {
    const calls = [];
    const report = await setupRuntimeDbRole({
      appDir: tmp,
      env: {
        MWB_DATABASE_URL: "postgres://admin:admin-secret@db.example/mwb",
        MWB_RUNTIME_DATABASE_ROLE: "mwb_runtime_app",
        MWB_RUNTIME_DATABASE_PASSWORD: "runtime-secret",
      },
      spawn: (command, args, options) => {
        calls.push({ command, args, input: options.input, env: options.env });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    assert.equal(report.roleName, "mwb_runtime_app");
    assert.equal(report.runtimeUrlRedacted, "postgres://mwb_runtime_app:***@db.example/mwb");
    assert.equal(report.wroteEnvShadow, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].env.PGPASSWORD, "admin-secret");
    const envText = await readFile(path.join(tmp, ".env.shadow"), "utf8");
    assert.match(envText, /^MWB_DATABASE_URL=postgres:\/\/admin:admin-secret@db\.example\/mwb/m);
    assert.match(envText, /^MWB_RUNTIME_DATABASE_URL=postgres:\/\/mwb_runtime_app:runtime-secret@db\.example\/mwb/m);
  } finally {
    process.argv = originalArgv;
  }
});

test("runtime DB role setup rejects unsafe role names and redacts reports", async () => {
  assert.throws(
    () => buildRuntimeRoleSetupSql({ roleName: "bad;role", password: "secret" }),
    /valid PostgreSQL role identifier|role/,
  );

  const runtimeUrl = runtimeUrlForRole({
    adminUrl: "postgres://admin:admin-secret@db.example/mwb",
    roleName: "mwb_runtime_app",
    password: "runtime-secret",
  });
  assert.equal(runtimeUrl, "postgres://mwb_runtime_app:runtime-secret@db.example/mwb");

  const rendered = renderRuntimeRoleSetupReport({
    roleName: "mwb_runtime_app",
    runtimeUrlRedacted: "postgres://mwb_runtime_app:***@db.example/mwb",
    wroteEnvShadow: true,
    envShadowPath: "/repo/.env.shadow",
  }).join("\n");
  assert.match(rendered, /mwb_runtime_app/);
  assert.doesNotMatch(rendered, /runtime-secret|admin-secret/);
});

test("package exposes runtime DB role setup command", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["db:runtime:role-setup"], "node scripts/db-runtime-role-setup.mjs");
});
