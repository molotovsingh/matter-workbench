import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reactAppPath = new URL("../react-ui/src/App.tsx", import.meta.url);

test("React command fallback ignores stale intent results after matter changes", async () => {
  const source = await readFile(reactAppPath, "utf8");

  assert.match(source, /const activeMatterNameRef = useLatestValue\(state\.activeMatter\?\.name \?\? null\)/);
  assert.match(source, /const matterName = state\.activeMatter\?\.name \?\? null/);
  assert.match(source, /api\.checkIntent\(\{ userRequest: cmd, matterName: matterName \?\? undefined \}\)/);
  assert.match(source, /if \(activeMatterNameRef\.current !== matterName\) return;\s*if \(result\.decision === 'run_existing_skill'/);
  assert.match(source, /catch \(e\) \{\s*if \(activeMatterNameRef\.current !== matterName\) return;/);
});
