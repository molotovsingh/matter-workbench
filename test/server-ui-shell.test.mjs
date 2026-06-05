import assert from "node:assert/strict";
import test from "node:test";
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
