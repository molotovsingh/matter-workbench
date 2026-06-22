import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  matterRootForBody,
  matterRootForQuery,
  runtimeDbMatterForBody,
  runtimeDbMatterForQuery,
  safeCaptureBetaSignal,
  usesRuntimeDbStorage,
} from "../routes/route-utils.mjs";

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

test("route matter query helper prefers explicit matter and can tolerate missing active matter", async () => {
  const calls = [];
  const matterStore = {
    resolveExistingMatter: async (name) => {
      calls.push(["resolve", name]);
      return { name, matterPath: `/matters/${name}` };
    },
    getActiveMatterRecord: () => null,
    getMatterRoot: () => {
      calls.push(["getMatterRoot"]);
      return null;
    },
    ensureMatterRoot: () => {
      calls.push(["ensureMatterRoot"]);
      throw new Error("active matter required");
    },
  };

  const explicitUrl = new URL("http://local.test/api/context?matter=Demo%20Matter");
  assert.deepEqual(await runtimeDbMatterForQuery(matterStore, explicitUrl), {
    name: "Demo Matter",
    matterPath: "/matters/Demo Matter",
  });
  assert.equal(await matterRootForQuery(matterStore, explicitUrl), "/matters/Demo Matter");

  const missingUrl = new URL("http://local.test/api/context");
  assert.equal(await runtimeDbMatterForQuery(matterStore, missingUrl, { allowMissingActive: true }), null);
  assert.equal(await matterRootForQuery(matterStore, missingUrl, { allowMissingActive: true }), null);
  await assert.rejects(() => runtimeDbMatterForQuery(matterStore, missingUrl), /active matter required/);
  assert.deepEqual(calls, [
    ["resolve", "Demo Matter"],
    ["resolve", "Demo Matter"],
    ["getMatterRoot"],
    ["getMatterRoot"],
    ["ensureMatterRoot"],
  ]);
});

test("route matter body helper prefers explicit matter and otherwise requires the active matter", async () => {
  const calls = [];
  const matterStore = {
    resolveExistingMatter: async (name) => {
      calls.push(["resolve", name]);
      return { name, matterPath: `/matters/${name}` };
    },
    getActiveMatterRecord: () => {
      calls.push(["getActiveMatterRecord"]);
      return { name: "Active Matter", matterPath: "/matters/Active Matter" };
    },
    ensureMatterRoot: () => {
      calls.push(["ensureMatterRoot"]);
      return "/matters/Active Matter";
    },
  };

  assert.deepEqual(await runtimeDbMatterForBody(matterStore, { matterName: "Body Matter" }), {
    name: "Body Matter",
    matterPath: "/matters/Body Matter",
  });
  assert.equal(await matterRootForBody(matterStore, { matterName: "Body Matter" }), "/matters/Body Matter");
  assert.deepEqual(await runtimeDbMatterForBody(matterStore, {}), {
    name: "Active Matter",
    matterPath: "/matters/Active Matter",
  });
  assert.equal(await matterRootForBody(matterStore, {}), "/matters/Active Matter");
  assert.deepEqual(calls, [
    ["resolve", "Body Matter"],
    ["resolve", "Body Matter"],
    ["getActiveMatterRecord"],
    ["ensureMatterRoot"],
  ]);
});

test("route files import shared runtime and signal helpers instead of redefining them", async () => {
  for (const routeFile of ROUTE_FILES) {
    const source = await readFile(routeFile, "utf8");
    assert.match(source, /from "\.\/route-utils\.mjs"/, `${routeFile} should import shared route utils`);
    assert.doesNotMatch(source, /function usesRuntimeDbStorage\(/, `${routeFile} should not redefine usesRuntimeDbStorage`);
    assert.doesNotMatch(source, /function safeCaptureBetaSignal\(/, `${routeFile} should not redefine safeCaptureBetaSignal`);
    assert.doesNotMatch(source, /function runtimeDbMatterForQuery\(/, `${routeFile} should not redefine runtimeDbMatterForQuery`);
    assert.doesNotMatch(source, /function matterRootForQuery\(/, `${routeFile} should not redefine matterRootForQuery`);
  }
  const workflowSource = await readFile("routes/matter-workflow-routes.mjs", "utf8");
  assert.doesNotMatch(workflowSource, /function runtimeDbMatterForBody\(/, "matter workflow routes should not redefine runtimeDbMatterForBody");
  assert.doesNotMatch(workflowSource, /function matterRootForBody\(/, "matter workflow routes should not redefine matterRootForBody");
});
