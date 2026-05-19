import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowButtonFiles = [
  "../react-ui/src/views/workflows/DescribeSourcesResult.tsx",
  "../react-ui/src/views/workflows/ExtractResult.tsx",
  "../react-ui/src/views/workflows/ListOfDatesResult.tsx",
  "../react-ui/src/views/workflows/DoctorResult.tsx",
];

test("React workflow button badges do not concatenate with action labels", async () => {
  for (const path of workflowButtonFiles) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(
      source,
      /\{['"] ['"]\}\s*<span>(Uses AI|Local)<\/span>/,
      `${path} should include a text space before the workflow button badge`,
    );
  }
});
