import test from "node:test";
import assert from "node:assert/strict";

import {
  getJson,
  runtimeDbMatter,
  runtimeDbTestPaths,
  startRuntimeDbTestServer,
} from "../test-support/runtime-db-api-fixtures.mjs";

test("runtime DB API fixture creates stable matter records with overrides", () => {
  const matter = runtimeDbMatter({
    name: "Custom Matter",
    clientName: "Custom Client",
  });

  assert.deepEqual(matter, {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Custom Matter",
    matterName: "Legal Caption",
    clientName: "Custom Client",
  });
});

test("runtime DB API fixture starts a postgres-mode test server", async () => {
  const { appDir, mattersHome } = await runtimeDbTestPaths("runtime-db-fixture");
  const server = await startRuntimeDbTestServer({ appDir, mattersHome });

  try {
    const matters = await getJson(server.baseUrl, "/api/matters");

    assert.equal(matters.enabled, true);
    assert.deepEqual(matters.matters, [runtimeDbMatter()]);
  } finally {
    await server.close();
  }
});
