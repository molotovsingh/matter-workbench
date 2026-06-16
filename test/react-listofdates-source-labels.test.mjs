import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const listOfDatesPath = new URL("../react-ui/src/views/workflows/ListOfDatesResult.tsx", import.meta.url);

test("React List of Dates preview prefers detailed source labels over short labels", async () => {
  const source = await readFile(listOfDatesPath, "utf8");
  const richLabelIndex = source.indexOf("source.source_label");
  const shortLabelIndex = source.indexOf("source.source_short_label");

  assert.notEqual(richLabelIndex, -1);
  assert.notEqual(shortLabelIndex, -1);
  assert.ok(
    richLabelIndex < shortLabelIndex,
    "List of Dates source labels should show detailed judgment/court labels before short nicknames.",
  );
});
