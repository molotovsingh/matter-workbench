import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { safeCaptureBetaSignal, usesRuntimeDbStorage } from "../routes/route-utils.mjs";

const ROUTE_FILES = [
  "routes/app-shell-routes.mjs",
  "routes/skill-factory-routes.mjs",
  "routes/matter-workflow-routes.mjs",
];

test("route runtime storage helper requires both runtime mode and an enabled DB service", () => {
  assert.equal(usesRuntimeDbStorage({}, { enabled: true }), false);
  assert.equal(usesRuntimeDbStorage({ hasRuntimeDbStorageMode: () => false }, { enabled: true }), false);
  assert.equal(usesRuntimeDbStorage({ hasRuntimeDbStorageMode: () => true }, { enabled: false }), false);
  assert.equal(usesRuntimeDbStorage({ hasRuntimeDbStorageMode: () => true }, { enabled: true }), true);
});

test("route beta signal helper never breaks the product route", async () => {
  let called = false;

  await safeCaptureBetaSignal(async () => {
    called = true;
    throw new Error("signal failed");
  });
  await safeCaptureBetaSignal(null);

  assert.equal(called, true);
});

test("route files import shared runtime and signal helpers instead of redefining them", async () => {
  for (const routeFile of ROUTE_FILES) {
    const source = await readFile(routeFile, "utf8");
    assert.match(source, /from "\.\/route-utils\.mjs"/, `${routeFile} should import shared route utils`);
    assert.doesNotMatch(source, /function usesRuntimeDbStorage\(/, `${routeFile} should not redefine usesRuntimeDbStorage`);
    assert.doesNotMatch(source, /function safeCaptureBetaSignal\(/, `${routeFile} should not redefine safeCaptureBetaSignal`);
  }
});
