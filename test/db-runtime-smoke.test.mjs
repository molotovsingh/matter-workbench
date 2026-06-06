import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

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
  assert.equal(report.runtimeDbStorageMode, "local-filesystem");

  const rendered = renderRuntimeDbSmokeReport(report).join("\n");
  assert.match(rendered, /runtime_db_enabled: yes/);
  assert.match(rendered, /passed: yes/);
  assert.doesNotMatch(rendered, /db\.example/);
});

test("runtime DB smoke verifies postgres storage mode can preview and stream a DB payload file", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-storage-smoke-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });
  const bytes = Buffer.from("# List of Dates");

  const report = await runRuntimeDbSmoke({
    env: {
      MATTERS_HOME: mattersHome,
      MWB_RUNTIME_DB: "postgres",
      MWB_RUNTIME_DB_STORAGE: "postgres",
    },
    serverOptions: {
      runtimeMatterIndex: {
        enabled: true,
        storageMode: "postgres",
        tenantId: "tenant-id",
        databaseUrlRedacted: "postgres://runtime:***@db.example/mwb",
        listMatterFolders: async () => [{ id: "matter-id", name: "Smoke DB Matter", matterName: "Legal Caption" }],
        findMatterFolder: async () => ({ id: "matter-id", name: "Smoke DB Matter", matterName: "Legal Caption" }),
      },
      runtimeDbStorageService: {
        enabled: true,
        async readWorkspace(matter) {
          return {
            folderName: matter.name,
            inputLabel: `postgres:${matter.name}`,
            metadata: { matterName: matter.matterName, clientName: "Runtime Client" },
            fileCount: 1,
            directoryCount: 1,
            tree: {
              name: matter.name,
              kind: "directory",
              path: "",
              children: [{
                name: "List of Dates.md",
                kind: "file",
                path: "10_Library/List of Dates.md",
                size: bytes.length,
                previewable: true,
                previewKind: "text",
              }],
            },
          };
        },
        async readFilePreview(relativePath) {
          return { path: relativePath, name: "List of Dates.md", ext: "md", content: bytes.toString("utf8") };
        },
        async getRawFile() {
          return {
            contentType: "text/markdown; charset=utf-8",
            fileSize: bytes.length,
            safeFilename: "List of Dates.md",
            stream: Readable.from(bytes),
          };
        },
      },
    },
  });

  assert.equal(report.passed, true);
  assert.equal(report.runtimeDbStorageMode, "postgres");
  assert.equal(report.workspaceReadable, true);
  assert.equal(report.storageFilePreviewReadable, true);
  assert.equal(report.storageRawReadable, true);
  assert.equal(report.filePreviewPath, "10_Library/List of Dates.md");

  const rendered = renderRuntimeDbSmokeReport(report).join("\n");
  assert.match(rendered, /runtime_db_storage_mode: postgres/);
  assert.match(rendered, /storage_file_preview_readable: yes/);
  assert.match(rendered, /storage_raw_readable: yes/);
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

test("package and docs expose the runtime DB smoke command and storage-mode boundary", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["db:runtime:smoke"], "node scripts/db-runtime-smoke.mjs");

  const dbReadme = await readFile(new URL("../db/README.md", import.meta.url), "utf8");
  assert.match(dbReadme, /npm run db:runtime:smoke/);
  assert.match(dbReadme, /read\/file-custody surfaces are DB-backed/i);
  assert.match(dbReadme, /runtime DB materialization bridge/i);
  assert.match(dbReadme, /foreground local actions/i);
  assert.match(dbReadme, /storage_object_payloads/i);

  const handoff = await readFile(new URL("../docs/database-transition-handoff.md", import.meta.url), "utf8");
  assert.match(handoff, /Accepted Runtime DB Storage And Write Bridge/);
  assert.match(handoff, /Accepted DB Payload Custody Slice/);
  assert.match(handoff, /\/api\/matters/);
  assert.match(handoff, /\/api\/workspace/);
  assert.match(handoff, /runtime DB/i);
});
