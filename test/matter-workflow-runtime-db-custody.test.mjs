import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const matterWorkflowRoutesPath = new URL("../routes/matter-workflow-routes.mjs", import.meta.url);

test("runtime DB matter story route stays DB-native", async () => {
  const source = await readFile(matterWorkflowRoutesPath, "utf8");
  const routeStart = source.indexOf('exactRoute("POST", "/api/matter-story"');
  const nextRouteStart = source.indexOf('exactRoute("POST", "/api/doctor/scan"', routeStart);

  assert.notEqual(routeStart, -1);
  assert.notEqual(nextRouteStart, -1);

  const routeSource = source.slice(routeStart, nextRouteStart);
  assert.match(routeSource, /assertRuntimeDbMatterStoryAvailable/);
  assert.match(routeSource, /readMatterContextPacket/);
  assert.match(routeSource, /readMatterJson/);
  assert.match(routeSource, /persistTextArtifacts/);
  assert.match(routeSource, /persistMatterJson/);
  assert.doesNotMatch(routeSource, /runRuntimeDbMaterializedWorkflow/);
  assert.doesNotMatch(routeSource, /runMaterializedMatterWrite/);
  assert.doesNotMatch(routeSource, /matterRootOverride: matterRoot/);
});
