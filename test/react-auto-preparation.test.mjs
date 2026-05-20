import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../react-ui/src/App.tsx", import.meta.url);
const newMatterPath = new URL("../react-ui/src/views/NewMatterForm.tsx", import.meta.url);
const addFilesPath = new URL("../react-ui/src/views/AddFilesForm.tsx", import.meta.url);
const runnerPath = new URL("../react-ui/src/lib/autoPreparationRunner.ts", import.meta.url);
const overviewPath = new URL("../react-ui/src/views/MatterOverview.tsx", import.meta.url);
const mainContentPath = new URL("../react-ui/src/components/layout/MainContent.tsx", import.meta.url);
const homeLandingPath = new URL("../react-ui/src/views/HomeLanding.tsx", import.meta.url);
const prepareMatterPath = new URL("../react-ui/src/views/workflows/PrepareMatterResult.tsx", import.meta.url);

test("React starts automatic preparation after first upload and added files", async () => {
  const app = await readFile(appPath, "utf8");
  const newMatter = await readFile(newMatterPath, "utf8");
  const addFiles = await readFile(addFilesPath, "utf8");

  assert.match(app, /function handleMatterCreated\(name: string, opts: \{ autoPrepare\?: boolean \} = \{\}\)/);
  assert.match(app, /activeMatterNameRef\.current = name/);
  assert.match(app, /if \(opts\.autoPrepare\) \{/);
  assert.match(app, /startAutoPreparation\(name,/);
  assert.match(newMatter, /const metadata: Record<string, string> = \{ matterName: name\.trim\(\) \}/);
  assert.match(app, /async function handleAddFilesDone\(opts: \{ autoPrepare\?: boolean \} = \{\}\)/);
  assert.match(app, /startAutoPreparation\(matterName,/);
  assert.match(newMatter, /onCreated\(name\.trim\(\), \{ autoPrepare: files\.length > 0 \}\)/);
  assert.match(addFiles, /onDone\(\{ autoPrepare: \(result\.intakeAdded\?\.unique \?\? collected\.length\) > 0 \}\)/);
});

test("React automatic preparation tolerates switch render gap but cancels after matter leaves", async () => {
  const app = await readFile(appPath, "utf8");
  const context = await readFile(new URL("../react-ui/src/store/AppContext.tsx", import.meta.url), "utf8");

  assert.match(app, /let sawTargetMatter = activeMatterNameRef\.current === cleanMatterName/);
  assert.match(app, /if \(activeName === cleanMatterName\) \{[\s\S]*sawTargetMatter = true;[\s\S]*return false;[\s\S]*\}/);
  assert.match(app, /return sawTargetMatter \|\| Boolean\(activeName\)/);
  assert.match(context, /case 'SET_PREPARATION_RUN'/);
  assert.match(context, /dispatch\(\{ type: 'SET_PREPARATION_RUN', payload: null \}\)/);
});

test("React automatic preparation runner includes List of Dates and label-only refresh", async () => {
  const runner = await readFile(runnerPath, "utf8");
  const prepareMatter = await readFile(prepareMatterPath, "utf8");

  assert.match(runner, /id: 'create-listofdates', label: 'Building List of Dates'/);
  assert.match(runner, /api\.runCreateListOfDates\(body\)/);
  assert.match(runner, /api\.refreshListOfDatesLabels\(\{ matterName, dryRun: false \}\)/);
  assert.match(runner, /LABEL_REFRESH_NEEDED/);
  assert.match(prepareMatter, /runPreparationStage\(matchedStage, matterName\)/);
  assert.match(prepareMatter, /runAutomaticPreparation\(\{/);
});

test("React matter overview can force a full preparation rerun", async () => {
  const app = await readFile(appPath, "utf8");
  const runner = await readFile(runnerPath, "utf8");
  const overview = await readFile(overviewPath, "utf8");
  const mainContent = await readFile(mainContentPath, "utf8");
  const homeLanding = await readFile(homeLandingPath, "utf8");

  assert.match(runner, /mode = 'needed'/);
  assert.match(runner, /const FULL_PREPARATION_STAGES: PreparationStage\[\] = \[/);
  assert.match(runner, /slash: '\/matter-init'[\s\S]*slash: '\/extract'[\s\S]*slash: '\/describe_sources'[\s\S]*slash: '\/create_listofdates'/);
  assert.match(runner, /if \(mode === 'full'\) \{/);
  assert.match(runner, /const finalPlan = await api\.getPrepareMatter\(matterName\)/);
  assert.doesNotMatch(runner, /setupStage && isCurrentPreparationStage\(setupStage\)/);
  assert.doesNotMatch(runner, /rerun kept: \$\{stageLabel\(stage\)\}/);
  assert.match(runner, /publishProgress = \(run: PreparationRunStatus\) => \{[\s\S]*if \(!isStale\(\)\) onProgress\(run\);/);
  assert.match(runner, /publishTerminal = \(lines: string\[\]\) => \{[\s\S]*if \(!isStale\(\)\) appendTerminal\(lines\);/);
  assert.match(runner, /runPreparationStage\(stage, matterName, \{[\s\S]*forceExtractRefresh: true,[\s\S]*forceListOfDatesRegeneration: true,/);
  assert.match(runner, /api\.runExtract\(\{ \.\.\.body, forceRefresh: options\.forceExtractRefresh === true \}\)/);
  assert.match(runner, /!options\.forceListOfDatesRegeneration && stage\.rerunAdvice\?\.dependencyState === LIST_OF_DATES_DEPENDENCY_STATES\.LABEL_REFRESH_NEEDED/);
  assert.doesNotMatch(runner, /for \(const stage of FULL_PREPARATION_STAGES\) \{[\s\S]{0,80}if \(isStale\(\)\) return staleResult\(\)/);
  assert.match(app, /mode: 'full'/);
  assert.match(app, /initialMessage: 'Running preparation again…'/);
  assert.match(app, /onRunPreparationAgain=\{handleRunPreparationAgain\}/);
  assert.match(mainContent, /onRunPreparationAgain: \(matterName: string\) => void/);
  assert.match(homeLanding, /<MatterOverview onCommand=\{onCommand\} onRunPreparationAgain=\{onRunPreparationAgain\} \/>/);
  assert.match(overview, /Run preparation again/);
  assert.match(overview, /matter-preparation-title[\s\S]*Matter Preparation[\s\S]*preparationHeadlineLabel/);
  assert.match(overview, /matter-preparation-actions[\s\S]*Run preparation again/);
  assert.match(overview, /disabled=\{preparationRun\?\.state === 'running'\}/);
  assert.match(overview, /onRunPreparationAgain\(matterName\)/);
});

test("React automatic preparation does not report prepared when workspace refresh fails", async () => {
  const app = await readFile(appPath, "utf8");
  const prepareMatter = await readFile(prepareMatterPath, "utf8");

  for (const source of [app, prepareMatter]) {
    assert.match(source, /const refreshed = await refreshActiveMatterWorkspace\(/);
    assert.match(source, /const refreshed = await refreshActiveMatterWorkspace\([\s\S]*?\);\n\s+if \(isStale\(\)\) return;/);
    assert.match(source, /const finalState = refreshed \? result\.state : 'needs_review'/);
    assert.match(source, /Refresh the matter view to see the latest files/);
    assert.match(source, /finalState === 'prepared' \? 'Matter prepared' : 'Matter needs review'/);
  }
});

test("React automatic preparation does not fail downstream blocked steps while an upstream step can run", async () => {
  const runner = await readFile(runnerPath, "utf8");

  assert.match(runner, /const nextStage = firstRunnablePreparationStage\(plan\)/);
  assert.match(runner, /mergePlanIntoStatus\(status, plan, \{ markBlocked: !nextStage \}\)/);
  assert.match(runner, /mergePlanIntoStatus\(advisoryStatus, finalPlan, \{ markBlocked: !finalNextStage \}\)/);
  assert.match(runner, /else if \(markBlocked && stage\.action === PREPARATION_STAGE_ACTIONS\.BLOCKED\)/);
});

test("React workspace refresh does not reselect a matter after it was cleared", async () => {
  const context = await readFile(new URL("../react-ui/src/store/AppContext.tsx", import.meta.url), "utf8");

  assert.match(context, /if \(activeMatterNameRef\.current !== targetMatterName\) \{/);
  assert.doesNotMatch(context, /activeMatterNameRef\.current && activeMatterNameRef\.current !== targetMatterName/);
});

test("React matter overview presents preparation and advisory language", async () => {
  const overview = await readFile(overviewPath, "utf8");

  assert.match(overview, /Matter Preparation/);
  assert.match(overview, /Preparation Advisory/);
  assert.match(overview, /Review the preparation status and advisory before drafting/);
  assert.match(overview, /Automatic preparation has run for this matter/);
  assert.match(overview, /Automatic preparation is running/);
  assert.match(overview, /Automatic preparation stopped/);
  assert.match(overview, /preparationRefreshKey/);
  assert.match(overview, /<PipelineCard[\s\S]*refreshKey=\{preparationRefreshKey\}/);
  assert.match(overview, /<AttentionCard matterName=\{matter\.name\} refreshKey=\{preparationRefreshKey\} preparationRun=\{preparationRun\}/);
  assert.match(overview, /Preparing a fresh advisory\. The previous advisory will be replaced when this run finishes\./);
  assert.match(overview, /\}, \[matterName, refreshKey, isPreparing\]\)/);
  assert.match(overview, /preparationRun/);
  assert.doesNotMatch(overview, /Matter readiness/);
  assert.doesNotMatch(overview, /Developer attention/);
});
