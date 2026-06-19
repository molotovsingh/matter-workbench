import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillFactoryRoutesPath = new URL("../routes/skill-factory-routes.mjs", import.meta.url);

test("Skill Factory runtime DB sample and creation paths stay DB-native", async () => {
  const source = await readFile(skillFactoryRoutesPath, "utf8");
  const sampleStart = source.indexOf("async function generateRuntimeDbSampleOutput");
  const createStart = source.indexOf("async function createRuntimeDbSkillFromApprovedSample");
  const matterNameStart = source.indexOf("function matterNameForSampleOutput", createStart);

  assert.notEqual(sampleStart, -1);
  assert.notEqual(createStart, -1);
  assert.notEqual(matterNameStart, -1);

  const sampleAndCreationSource = source.slice(sampleStart, matterNameStart);
  assert.match(sampleAndCreationSource, /readMatterContextPacket/);
  assert.match(sampleAndCreationSource, /generateSampleOutputFromPacket/);
  assert.match(sampleAndCreationSource, /matterContextPacketOverride/);
  assert.match(sampleAndCreationSource, /assertRuntimeDbMatterContextPacketAvailable/);
  assert.doesNotMatch(sampleAndCreationSource, /runMaterializedMatterRead/);
  assert.doesNotMatch(sampleAndCreationSource, /matterRootOverride: matterRoot/);
});
