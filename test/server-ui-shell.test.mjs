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
