import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WORKBENCH_BASE_URL,
  DEFAULT_WORKBENCH_HOST,
  DEFAULT_WORKBENCH_PORT,
} from "../shared/local-server-defaults.mjs";
import { createWorkbenchServer } from "../server.mjs";

test("local server and smoke defaults share one workbench URL", async () => {
  assert.equal(DEFAULT_WORKBENCH_HOST, "127.0.0.1");
  assert.equal(DEFAULT_WORKBENCH_PORT, 4173);
  assert.equal(DEFAULT_WORKBENCH_BASE_URL, "http://127.0.0.1:4173");

  const app = await createWorkbenchServer({ env: {}, port: undefined });

  assert.equal(app.host, DEFAULT_WORKBENCH_HOST);
  assert.equal(app.port, DEFAULT_WORKBENCH_PORT);
});
