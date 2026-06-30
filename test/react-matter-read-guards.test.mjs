import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const matterOverviewPath = new URL("../react-ui/src/views/MatterOverview.tsx", import.meta.url);
const contextPreviewPath = new URL("../react-ui/src/views/workflows/ContextPreview.tsx", import.meta.url);
const prepareMatterPath = new URL("../react-ui/src/views/workflows/PrepareMatterResult.tsx", import.meta.url);

test("React matter overview ignores stale preparation-plan and attention responses", async () => {
  const source = await readFile(matterOverviewPath, "utf8");

  assert.match(source, /let cancelled = false;[\s\S]*api\s*\n\s*\.getPrepareMatter\(matterName\)/);
  assert.match(source, /\.then\(\(plan\) => \{\s*if \(cancelled\) return;/);
  assert.match(source, /return \(\) => \{\s*cancelled = true;\s*\};/);
  assert.match(source, /api\s*\n\s*\.getMatterAttention\(matterName\)[\s\S]*if \(cancelled\) return;[\s\S]*setData\(payload\)/);
});

test("React context preview ignores stale matter responses", async () => {
  const source = await readFile(contextPreviewPath, "utf8");

  assert.match(source, /const loadContext = useCallback\(async \(\{ matterName, isStale = \(\) => false \}/);
  assert.match(source, /const data = await api\.getMatterContext\(matterName\);\s*if \(isStale\(\)\) return;/);
  assert.match(source, /finally \{\s*if \(!isStale\(\)\) setLoading\(false\);/);
  assert.match(source, /void loadContext\(\{ matterName, isStale: \(\) => cancelled \}\)/);
});

test("React Prepare Matter ignores stale plan responses", async () => {
  const source = await readFile(prepareMatterPath, "utf8");

  assert.match(source, /const loadPlan = useCallback\(async \(\{ matterName, isStale = \(\) => false \}/);
  assert.match(source, /const result = await api\.getPrepareMatter\(matterName\);\s*if \(isStale\(\)\) return;/);
  assert.match(source, /finally \{\s*if \(!isStale\(\)\) setLoading\(false\);/);
  assert.match(source, /void loadPlan\(\{ matterName, isStale: \(\) => cancelled \}\)/);
  assert.match(source, /void loadPlan\(\{\s*matterName,\s*isStale: \(\) => Boolean\(matterName && activeMatterNameRef\.current !== matterName\),\s*\}\);/);
});
