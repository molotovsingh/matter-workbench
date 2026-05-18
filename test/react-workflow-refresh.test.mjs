import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowFiles = [
  {
    name: "Extract",
    path: "../react-ui/src/views/workflows/ExtractResult.tsx",
    runPattern: /api\.runExtract/,
    refreshPattern: /refreshActiveMatterWorkspace\(\{ failurePrefix: '\[workspace\] refresh failed after Extract update' \}\)/,
  },
  {
    name: "Source Labels",
    path: "../react-ui/src/views/workflows/DescribeSourcesResult.tsx",
    runPattern: /api\.runDescribeSources/,
    refreshPattern: /refreshActiveMatterWorkspace\(\{ failurePrefix: '\[workspace\] refresh failed after Source Labels update' \}\)/,
  },
  {
    name: "Prepare Matter",
    path: "../react-ui/src/views/workflows/PrepareMatterResult.tsx",
    runPattern: /runPreparationStage/,
    refreshPattern: /refreshActiveMatterWorkspace\(\{ failurePrefix: '\[workspace\] refresh failed after preparation update' \}\)/,
  },
  {
    name: "Doctor fixes",
    path: "../react-ui/src/views/workflows/DoctorResult.tsx",
    runPattern: /api\.runDoctorFix/,
    refreshPattern: /refreshActiveMatterWorkspace\(\{ failurePrefix: '\[workspace\] refresh failed after Doctor fixes' \}\)/,
  },
];

test("React artifact-writing workflows refresh active matter workspace after writes", async () => {
  for (const workflow of workflowFiles) {
    const source = await readFile(new URL(workflow.path, import.meta.url), "utf8");
    assert.match(source, /refreshActiveMatterWorkspace/, `${workflow.name} should use the shared workspace refresh owner`);
    assert.match(source, workflow.runPattern, `${workflow.name} should still call its artifact-writing API`);
    assert.match(source, workflow.refreshPattern, `${workflow.name} should refresh after successful writes`);
  }
});
