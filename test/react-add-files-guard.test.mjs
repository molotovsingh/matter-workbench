import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const addFilesPath = new URL("../react-ui/src/views/AddFilesForm.tsx", import.meta.url);

test("React Add Files keeps overlap and upload responses scoped to the starting matter", async () => {
  const source = await readFile(addFilesPath, "utf8");

  assert.match(source, /useLatestValue\(state\.activeMatter\?\.name \?\? null\)/);
  assert.match(source, /const matterName = state\.activeMatter\?\.name/);
  assert.match(source, /proposedName: matterName/);
  assert.match(source, /fd\.append\('matterName', matterName\)/);
  assert.match(source, /activeMatterNameRef\.current !== matterName/);
  assert.match(source, /activeMatterNameRef\.current === matterName/);
});

test("React Add Files continues safely when duplicate pre-check is skipped", async () => {
  const source = await readFile(addFilesPath, "utf8");

  assert.match(source, /browserFileHashSkipReason/);
  assert.match(source, /hashFilesSha256IfAvailable/);
  assert.match(source, /if \(!hashes\)/);
  assert.match(source, /hashSkipReason === 'selection_too_large'/);
  assert.match(source, /upload is continuing normally/);
  assert.match(source, /api\.checkOverlap/);
});
