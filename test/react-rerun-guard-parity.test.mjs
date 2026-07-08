import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const guardedWorkflowFiles = [
  {
    name: "Source Labels",
    path: "../react-ui/src/views/workflows/DescribeSourcesResult.tsx",
    skill: "/describe_sources",
  },
  {
    name: "List of Dates",
    path: "../react-ui/src/views/workflows/ListOfDatesResult.tsx",
    skill: "/create_case_timeline",
  },
];

test("React paid workflow run buttons enter the rerun guard before provider calls", async () => {
  for (const workflow of guardedWorkflowFiles) {
    const source = await readFile(new URL(workflow.path, import.meta.url), "utf8");
    const handleRunClick = source.match(/function handleRunClick\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";

    assert.match(handleRunClick, /setConfirming\(true\)/, `${workflow.name} should open rerun guard on run click`);
    assert.doesNotMatch(handleRunClick, /executeRun\(\)/, `${workflow.name} should not call provider directly from run click`);
    assert.match(source, /<RerunConfirmDialog[\s\S]*?onConfirm=\{executeRun\}/, `${workflow.name} should run only after rerun advice confirms`);
    assert.match(source, new RegExp(`skill="${workflow.skill.replace("/", "\\/")}"`), `${workflow.name} should query advice for ${workflow.skill}`);
  }
});
