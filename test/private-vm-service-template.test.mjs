import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtimeUnitPath = new URL("../deployment/private-vm/matter-workbench-runtime.service", import.meta.url);

test("private VM runtime service binds the app to loopback behind HTTPS proxy", async () => {
  const unit = await readFile(runtimeUnitPath, "utf8");

  assert.match(unit, /scripts\/start-runtime-server\.mjs --host 127\.0\.0\.1 --port 4191/);
  assert.doesNotMatch(unit, /--host 0\.0\.0\.0/);
});
