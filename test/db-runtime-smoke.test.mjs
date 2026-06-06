import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  renderRuntimeDbSmokeReport,
  runRuntimeDbSmoke,
} from "../scripts/db-runtime-smoke.mjs";

test("runtime DB smoke starts the app, lists DB matters, switches, and reads local workspace", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-smoke-"));
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Smoke DB Matter");
  await mkdir(path.join(matterRoot, "10_Library"), { recursive: true });
  await writeFile(path.join(matterRoot, "matter.json"), JSON.stringify({
    matter_name: "Smoke DB Matter",
    client_name: "Runtime Client",
  }, null, 2));

  const report = await runRuntimeDbSmoke({
    env: {
      MATTERS_HOME: mattersHome,
      MWB_RUNTIME_DB: "postgres",
    },
    serverOptions: {
      runtimeMatterIndex: {
        enabled: true,
        tenantId: "tenant-id",
        databaseUrlRedacted: "postgres://runtime:***@db.example/mwb",
        listMatterFolders: async () => [{ name: "Smoke DB Matter", matterName: "Legal Caption" }],
        findMatterFolder: async () => ({ name: "Smoke DB Matter", matterName: "Legal Caption" }),
      },
    },
  });

  assert.equal(report.passed, true);
  assert.equal(report.runtimeDbEnabled, true);
  assert.equal(report.matterCount, 1);
  assert.equal(report.targetMatter, "Smoke DB Matter");
  assert.equal(report.activeMatter, "Smoke DB Matter");
  assert.equal(report.fileCount, 1);
  assert.equal(report.workspaceReadable, true);

  const rendered = renderRuntimeDbSmokeReport(report).join("\n");
  assert.match(rendered, /runtime_db_enabled: yes/);
  assert.match(rendered, /passed: yes/);
  assert.doesNotMatch(rendered, /db\.example/);
});

test("runtime DB smoke fails when the app is not in runtime DB mode", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-smoke-disabled-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });

  const report = await runRuntimeDbSmoke({
    env: { MATTERS_HOME: mattersHome },
  });

  assert.equal(report.passed, false);
  assert.equal(report.runtimeDbEnabled, false);
  assert.match(report.error, /MWB_RUNTIME_DB=postgres/);
});

test("runtime DB smoke reports cutover gate errors instead of throwing", async () => {
  const report = await runRuntimeDbSmoke({
    env: {
      MWB_RUNTIME_DB: "postgres",
      MWB_DATABASE_URL: "postgres://runtime:secret@db.example/mwb",
    },
  });

  assert.equal(report.passed, false);
  assert.equal(report.runtimeDbEnabled, false);
  assert.match(report.error, /MWB_DB_RUNTIME_CUTOVER_APPROVED/);
  assert.doesNotMatch(report.error, /secret/);
});

test("package and docs expose the runtime DB smoke command without implying full storage cutover", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["db:runtime:smoke"], "node scripts/db-runtime-smoke.mjs");

  const dbReadme = await readFile(new URL("../db/README.md", import.meta.url), "utf8");
  assert.match(dbReadme, /npm run db:runtime:smoke/);
  assert.match(dbReadme, /Postgres owns the matter index/i);
  assert.match(dbReadme, /file\s+bytes[\s\S]*remain[\s\S]*filesystem/i);

  const handoff = await readFile(new URL("../docs/database-transition-handoff.md", import.meta.url), "utf8");
  assert.match(handoff, /Accepted First Runtime Slice/);
  assert.match(handoff, /\/api\/matters/);
  assert.match(handoff, /original files and PDF bytes/i);
});
