import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowFiles = [
  {
    name: "Extract",
    path: "../react-ui/src/views/workflows/ExtractResult.tsx",
    runPattern: /api\.runExtract/,
    refreshPattern: /expectedMatterName: matterName,[\s\S]*failurePrefix: '\[workspace\] refresh failed after Extract update'/,
  },
  {
    name: "Source Labels",
    path: "../react-ui/src/views/workflows/DescribeSourcesResult.tsx",
    runPattern: /api\.runDescribeSources/,
    refreshPattern: /expectedMatterName: matterName,[\s\S]*failurePrefix: '\[workspace\] refresh failed after Source Labels update'/,
  },
  {
    name: "List of Dates",
    path: "../react-ui/src/views/workflows/ListOfDatesResult.tsx",
    runPattern: /api\.runCreateListOfDates/,
    refreshPattern: /expectedMatterName: matterName,[\s\S]*failurePrefix: '\[workspace\] refresh failed after List of Dates update'/,
  },
  {
    name: "Prepare Matter",
    path: "../react-ui/src/views/workflows/PrepareMatterResult.tsx",
    runPattern: /runPreparationStage/,
    refreshPattern: /expectedMatterName: matterName,[\s\S]*failurePrefix: '\[workspace\] refresh failed after preparation update'/,
  },
  {
    name: "Doctor fixes",
    path: "../react-ui/src/views/workflows/DoctorResult.tsx",
    runPattern: /api\.runDoctorFix/,
    refreshPattern: /expectedMatterName: matterName,[\s\S]*failurePrefix: '\[workspace\] refresh failed after Doctor fixes'/,
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

test("React workspace refresh skips stale async results after matter changes", async () => {
  const source = await readFile(new URL("../react-ui/src/store/AppContext.tsx", import.meta.url), "utf8");

  assert.match(source, /expectedMatterName = state\.activeMatter\?\.name/);
  assert.match(source, /const activeMatterNameRef = useRef<string \| null>\(null\)/);
  assert.match(source, /activeMatterNameRef\.current = matter\?\.name \?\? null/);
  assert.match(source, /activeMatterNameRef\.current = null/);
  assert.match(source, /if \(expectedMatterName && activeMatterNameRef\.current !== expectedMatterName\) \{/);
  assert.match(source, /workspaceMatchesMatter\(workspace, expectedMatterName\)/);
  assert.match(source, /\[workspace\] refresh skipped - active matter changed/);
  assert.match(source, /function workspaceMatchesMatter\(workspace: WorkspaceApiResponse, expectedMatterName\?: string\): boolean/);
  assert.match(source, /workspace\.folderName, workspace\.metadata\?\.matterName/);
});

test("React workflow run results are scoped to the matter that started the run", async () => {
  for (const workflow of workflowFiles) {
    const source = await readFile(new URL(workflow.path, import.meta.url), "utf8");
    assert.match(source, /useLatestValue\(state\.activeMatter\?\.name \?\? null\)/, `${workflow.name} should track the latest active matter`);
    assert.match(source, /activeMatterNameRef\.current !== matterName/, `${workflow.name} should ignore stale matter responses`);
    assert.match(source, /activeMatterNameRef\.current === matterName/, `${workflow.name} should only clear loading state for the current matter`);
  }
});

test("React context search ignores stale matter search responses", async () => {
  const source = await readFile(new URL("../react-ui/src/views/workflows/ContextSearch.tsx", import.meta.url), "utf8");

  assert.match(source, /useLatestValue\(state\.activeMatter\?\.name \?\? null\)/);
  assert.match(source, /const matterName = state\.activeMatter\?\.name/);
  assert.match(source, /activeMatterNameRef\.current !== matterName/);
  assert.match(source, /activeMatterNameRef\.current === matterName/);
});

test("React label refresh and custom skill runs send the selected matter explicitly", async () => {
  const listOfDatesSource = await readFile(new URL("../react-ui/src/views/workflows/ListOfDatesResult.tsx", import.meta.url), "utf8");
  const skillsPageSource = await readFile(new URL("../react-ui/src/views/SkillsPage.tsx", import.meta.url), "utf8");
  const typesSource = await readFile(new URL("../react-ui/src/types/index.ts", import.meta.url), "utf8");

  assert.match(listOfDatesSource, /api\.refreshListOfDatesLabels\(\{ matterName, dryRun: false \}\)/);
  assert.match(skillsPageSource, /api\.runConfigurableSkill\(\{ slash: skill\.slash, overwrite: false, matterName \}\)/);
  assert.match(skillsPageSource, /activeMatterNameRef\.current !== matterName/);
  assert.match(typesSource, /export interface ConfigurableSkillRunRequest \{[\s\S]*matterName\?: string;/);
});

test("React read-side matter APIs pass the selected matter explicitly", async () => {
  const apiClientSource = await readFile(new URL("../react-ui/src/api/client.ts", import.meta.url), "utf8");
  const overviewSource = await readFile(new URL("../react-ui/src/views/MatterOverview.tsx", import.meta.url), "utf8");
  const prepareSource = await readFile(new URL("../react-ui/src/views/workflows/PrepareMatterResult.tsx", import.meta.url), "utf8");
  const contextPreviewSource = await readFile(new URL("../react-ui/src/views/workflows/ContextPreview.tsx", import.meta.url), "utf8");
  const contextSearchSource = await readFile(new URL("../react-ui/src/views/workflows/ContextSearch.tsx", import.meta.url), "utf8");
  const rerunDialogSource = await readFile(new URL("../react-ui/src/components/RerunConfirmDialog.tsx", import.meta.url), "utf8");
  const listOfDatesSource = await readFile(new URL("../react-ui/src/views/workflows/ListOfDatesResult.tsx", import.meta.url), "utf8");

  assert.match(apiClientSource, /function withQuery\(path: string, query: Record<string, string \| undefined \| null>\): string/);
  assert.match(overviewSource, /\.getMatterStatus\(matterName\)/);
  assert.match(overviewSource, /\.getMatterAttention\(matterName\)/);
  assert.match(prepareSource, /api\.getPrepareMatter\(matterName\)/);
  assert.match(contextPreviewSource, /api\.getMatterContext\(matterName\)/);
  assert.match(contextSearchSource, /api\.searchMatterContext\(query, matterName\)/);
  assert.match(rerunDialogSource, /api\.getRerunAdvice\(skill, matterName\)/);
  assert.match(listOfDatesSource, /matterName=\{state\.activeMatter\?\.name\}/);
});
