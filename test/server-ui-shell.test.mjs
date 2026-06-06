import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkbenchServer } from "../server.mjs";

test("server always uses the React shell", async () => {
  const current = await createWorkbenchServer({ env: {}, port: 0 });
  assert.equal(current.uiShell, "react");

  const react = await createWorkbenchServer({ env: { MWB_UI_SHELL: "react" }, port: 0 });
  assert.equal(react.uiShell, "react");

  const legacy = await createWorkbenchServer({ env: { MWB_UI_SHELL: "legacy" }, port: 0 });
  assert.equal(legacy.uiShell, "react");

  const invalid = await createWorkbenchServer({ env: { MWB_UI_SHELL: "unknown" }, port: 0 });
  assert.equal(invalid.uiShell, "react");
});

test("local server startup does not depend on a reachable Postgres URL", async () => {
  const app = await createWorkbenchServer({
    env: {
      MWB_DATABASE_URL: "postgres://mwb_user:invalid@127.0.0.1:1/matter_workbench_shadow",
      DATABASE_URL: "postgres://mwb_user:invalid@127.0.0.1:1/matter_workbench_shadow",
    },
    port: 0,
  });

  assert.equal(app.uiShell, "react");
  assert.equal(app.services.env.MWB_DATABASE_URL, "postgres://mwb_user:invalid@127.0.0.1:1/matter_workbench_shadow");
});

test("runtime DB mode fails closed without explicit cutover approval", async () => {
  await assert.rejects(
    () => createWorkbenchServer({
      env: {
        MWB_RUNTIME_DB: "postgres",
        MWB_DATABASE_URL: "postgres://mwb_user:invalid@127.0.0.1:1/matter_workbench_shadow",
      },
      port: 0,
    }),
    /MWB_DB_RUNTIME_CUTOVER_APPROVED/,
  );
});

test("server can wire an approved runtime matter index into matter listing", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-server-"));
  const mattersHome = path.join(tmp, "matters");
  await mkdir(mattersHome, { recursive: true });

  const app = await createWorkbenchServer({
    env: { MATTERS_HOME: mattersHome },
    port: 0,
    runtimeMatterIndex: {
      enabled: true,
      listMatterFolders: async () => [{ name: "Runtime DB Matter" }],
      findMatterFolder: async () => null,
    },
  });

  assert.deepEqual(await app.services.matterStore.listMattersHomeChildren(), [
    { name: "Runtime DB Matter" },
  ]);
});
