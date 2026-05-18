import assert from "node:assert/strict";
import test from "node:test";
import { createWorkbenchServer } from "../server.mjs";

test("server defaults to legacy shell and only opts into React shell explicitly", async () => {
  const legacy = await createWorkbenchServer({ env: {}, port: 0 });
  assert.equal(legacy.uiShell, "legacy");

  const react = await createWorkbenchServer({ env: { MWB_UI_SHELL: "react" }, port: 0 });
  assert.equal(react.uiShell, "react");

  const invalid = await createWorkbenchServer({ env: { MWB_UI_SHELL: "unknown" }, port: 0 });
  assert.equal(invalid.uiShell, "legacy");
});
