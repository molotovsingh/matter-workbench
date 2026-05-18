import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const typesPath = new URL("../react-ui/src/types/index.ts", import.meta.url);

test("React MatterStatus type mirrors the backend stage contract", async () => {
  const source = await readFile(typesPath, "utf8");
  const matterStatusMatch = source.match(/export interface MatterStatus \{([\s\S]*?)\n\}/);
  const body = matterStatusMatch?.[1] || "";

  assert.match(body, /matterName: string/);
  assert.match(body, /matterRoot\?: string/);
  assert.match(body, /stages: PipelineStage\[\]/);
  assert.doesNotMatch(body, /extractionComplete/);
  assert.doesNotMatch(body, /completionPct/);
});
