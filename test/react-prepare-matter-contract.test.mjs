import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const prepareMatterPath = new URL("../react-ui/src/views/workflows/PrepareMatterResult.tsx", import.meta.url);

test("React Prepare Matter confirms paid steps without rerun-advice auto-run", async () => {
  const source = await readFile(prepareMatterPath, "utf8");

  assert.doesNotMatch(source, /RerunConfirmDialog/);
  assert.doesNotMatch(source, /getRerunAdvice/);
  assert.match(source, /matchedStage\.action === PREPARATION_STAGE_ACTIONS\.CONFIRM_PAID_RUN/);
  assert.match(source, /role="alertdialog"/);
  assert.match(source, /This step uses a paid AI provider\. Running it may incur costs\./);
  assert.match(source, /Run \{cleanCommandLabel\(plan\.nextStep\.slash\)\}/);
});
