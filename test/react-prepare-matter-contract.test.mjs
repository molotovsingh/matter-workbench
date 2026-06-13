import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const prepareMatterPath = new URL("../react-ui/src/views/workflows/PrepareMatterResult.tsx", import.meta.url);

test("React Prepare Matter keeps paid confirmation on the manual next-step path", async () => {
  const source = await readFile(prepareMatterPath, "utf8");

  assert.doesNotMatch(source, /RerunConfirmDialog/);
  assert.doesNotMatch(source, /getRerunAdvice/);
  assert.match(source, /matchedStage\.action === PREPARATION_STAGE_ACTIONS\.CONFIRM_PAID_RUN/);
  assert.match(source, /role="alertdialog"/);
  assert.match(source, /This step uses a paid AI provider\. Running it may incur costs\./);
  assert.match(source, /Run \{cleanCommandLabel\(plan\.nextStep\.slash\)\}/);
});

test("React Prepare Matter full-run button uses the shared automatic preparation runner", async () => {
  const source = await readFile(prepareMatterPath, "utf8");

  assert.match(source, /runAutomaticPreparation/);
  assert.match(source, /createInitialPreparationRun/);
  assert.match(source, /dispatch\(\{ type: 'SET_PREPARATION_RUN', payload: latestRun \}\)/);
  assert.match(source, /onProgress: \(status\) => \{/);
  assert.doesNotMatch(source, /pendingPaidConfirm/);
});

test("React Prepare Matter uses lawyer-facing matter detail language", async () => {
  const source = await readFile(prepareMatterPath, "utf8");

  assert.match(source, /Matter details are incomplete/);
  assert.match(source, /formatMissingMatterDetails\(plan\.metadataCheck\.missing\)/);
  assert.doesNotMatch(source, /Missing metadata/);
  assert.doesNotMatch(source, /matter\.json/);
});
