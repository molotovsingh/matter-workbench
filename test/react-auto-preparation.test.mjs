import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../react-ui/src/App.tsx", import.meta.url);
const newMatterPath = new URL("../react-ui/src/views/NewMatterForm.tsx", import.meta.url);
const addFilesPath = new URL("../react-ui/src/views/AddFilesForm.tsx", import.meta.url);
const runnerPath = new URL("../react-ui/src/lib/autoPreparationRunner.ts", import.meta.url);
const overviewPath = new URL("../react-ui/src/views/MatterOverview.tsx", import.meta.url);
const preparationRowActionsPath = new URL("../react-ui/src/lib/preparationRowActions.ts", import.meta.url);
const postureSummaryPath = new URL("../react-ui/src/components/matters/PostureSummary.tsx", import.meta.url);
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
  assert.match(newMatter, /const metadata: Record<string, string> = \{ matterName: cleanName \}/);
  assert.match(app, /async function handleAddFilesDone\(opts: \{ autoPrepare\?: boolean \} = \{\}\)/);
  assert.match(app, /startAutoPreparation\(matterName,/);
  assert.match(newMatter, /if \(files\.length === 0\) \{ setError\('Attach at least one source file\.'\); return; \}/);
  assert.match(newMatter, /onCreated\(createdName, \{ autoPrepare: true \}\)/);
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

test("React automatic preparation runner includes Case Timeline, story, posture diagnosis, and label-only refresh", async () => {
  const runner = await readFile(runnerPath, "utf8");
  const prepareMatter = await readFile(prepareMatterPath, "utf8");

  assert.match(runner, /id: 'create-listofdates', label: 'Building Case Timeline'/);
  assert.match(runner, /id: 'dispute-story', label: 'Writing dispute story'/);
  assert.match(runner, /id: 'procedural-posture-diagnosis', label: 'Diagnosing procedural posture'/);
  assert.match(runner, /api\.runCreateListOfDates\(body\)/);
  assert.match(runner, /api\.runMatterStory\(/);
  assert.match(runner, /api\.runProceduralPostureDiagnosis\(/);
  assert.match(runner, /overwrite: options\.forceStoryRegeneration === true \|\| stage\.state === 'stale'/);
  assert.match(runner, /api\.refreshListOfDatesLabels\(\{ matterName, dryRun: false \}\)/);
  assert.match(runner, /api\.queueNeededPreparation\(/);
  assert.match(runner, /startStage: normalizePreparationStartStage\(startStage\) \|\| undefined/);
  assert.match(runner, /firstNonCurrentStageBefore\(plan, startStage\)/);
  assert.match(runner, /api\.getJobs\(\{ matterName, kind, limit: 20 \}\)/);
  assert.match(runner, /server queue unavailable; running needed preparation in the browser session/);
  assert.match(runner, /progress is kept in Activity/);
  assert.match(runner, /api\.recordPreparationRunTelemetry\(/);
  assert.match(runner, /action: 'start'/);
  assert.match(runner, /action: 'stage'/);
  assert.match(runner, /action: 'finish'/);
  assert.match(runner, /createPreparationTelemetryRunId\(\)/);
  assert.match(runner, /safeRecordPreparationRunTelemetry/);
  assert.match(runner, /LABEL_REFRESH_NEEDED/);
  assert.match(runner, /startStageHeartbeat/);
  assert.match(runner, /Large or scanned PDFs can take several minutes/);
  assert.match(runner, /Keep this page open/);
  assert.match(prepareMatter, /runPreparationStage\(matchedStage, matterName\)/);
  assert.match(prepareMatter, /runAutomaticPreparation\(\{/);
});

test("React matter overview renders Matter Workbench story before original intake note", async () => {
  const overview = await readFile(overviewPath, "utf8");
  const preparationRowActions = await readFile(preparationRowActionsPath, "utf8");
  const postureSummary = await readFile(postureSummaryPath, "utf8");

  assert.match(overview, /<MatterStoryCard meta=\{meta\} \/>/);
  assert.match(overview, /<ProceduralPostureCard matterName=\{matter\.name\} refreshKey=\{preparationRefreshKey\} \/>/);
  assert.match(overview, /import \{ PostureSummary \} from '..\/components\/matters\/PostureSummary'/);
  assert.match(overview, /Matter Workbench story/);
  assert.match(overview, /Author: MW/);
  assert.match(overview, /Based on: \{caseTimelineSourceLabel\(source\?\.basedOn\)\}/);
  assert.match(overview, /Current Case Timeline/);
  assert.match(overview, /Original intake note/);
  assert.match(postureSummary, /function PostureSummary/);
  assert.match(postureSummary, /Simple view:/);
  assert.match(postureSummary, /Recommended route:/);
  assert.match(postureSummary, /Next best actions/);
  assert.match(postureSummary, /Full legal routes are saved in the Filing and Procedural Posture Diagnosis document/);
  assert.doesNotMatch(postureSummary, /Full legal routes are saved in \{status\.artifactPath\}/);
  assert.match(preparationRowActions, /Run saved Procedural Diagnosis/);
  assert.match(preparationRowActions, /Refresh saved Procedural Diagnosis/);
  assert.match(preparationRowActions, /Creates the Case Analysis Markdown\/JSON artifact, job, and receipt\. Not chat\./);
  assert.match(overview, /const readyForConfirmation = state === 'current_unconfirmed' && !hasRecordedConfirmation/);
  assert.match(overview, /postureConfirmationRecordedMessage/);
  assert.match(overview, /Confirm working posture/);
  assert.match(overview, /Disagree \/ correct/);
  assert.match(overview, /Not sure yet/);
  assert.match(overview, /isMwStorySource/);
});

test("React matter overview runs needed preparation by default", async () => {
  const app = await readFile(appPath, "utf8");
  const runner = await readFile(runnerPath, "utf8");
  const overview = await readFile(overviewPath, "utf8");
  const preparationRowActions = await readFile(preparationRowActionsPath, "utf8");
  const mainContent = await readFile(mainContentPath, "utf8");
  const homeLanding = await readFile(homeLandingPath, "utf8");

  assert.match(runner, /mode = 'needed'/);
  assert.match(runner, /const FULL_PREPARATION_STAGES: PreparationStage\[\] = \[/);
  assert.match(runner, /slash: '\/matter-init'[\s\S]*slash: '\/extract'[\s\S]*slash: '\/describe_sources'[\s\S]*slash: '\/create_listofdates'[\s\S]*slash: '\/the_story'[\s\S]*slash: '\/procedural_posture_diagnosis'/);
  assert.match(runner, /if \(mode === 'full'\) \{/);
  assert.match(runner, /const finalPlan = await api\.getPrepareMatter\(matterName\)/);
  assert.doesNotMatch(runner, /setupStage && isCurrentPreparationStage\(setupStage\)/);
  assert.doesNotMatch(runner, /rerun kept: \$\{stageLabel\(stage\)\}/);
  assert.match(runner, /publishProgress = \(run: PreparationRunStatus\) => \{[\s\S]*if \(!isStale\(\)\) onProgress\(run\);/);
  assert.match(runner, /publishTerminal = \(lines: string\[\]\) => \{[\s\S]*if \(!isStale\(\)\) appendTerminal\(lines\);/);
  assert.match(runner, /runPreparationStage\(stage, matterName, \{[\s\S]*forceExtractRefresh: true,[\s\S]*forceCaseTimelineRegeneration: true,[\s\S]*forcePostureDiagnosisRegeneration: true,/);
  assert.match(runner, /api\.runExtract\(\{ \.\.\.body, forceRefresh: options\.forceExtractRefresh === true \}\)/);
  assert.match(runner, /!options\.forceCaseTimelineRegeneration && stage\.rerunAdvice\?\.dependencyState === CASE_TIMELINE_DEPENDENCY_STATES\.LABEL_REFRESH_NEEDED/);
  assert.doesNotMatch(runner, /for \(const stage of FULL_PREPARATION_STAGES\) \{[\s\S]{0,80}if \(isStale\(\)\) return staleResult\(\)/);
  assert.match(app, /mode: 'needed'/);
  assert.match(app, /startStage/);
  assert.match(app, /preparationStartStageLabel/);
  assert.match(app, /handleForceFullPreparation[\s\S]*mode: 'full'/);
  assert.match(app, /initialMessage: startStage \? `Running preparation from \$\{fromLabel\}…` : 'Running needed preparation…'/);
  assert.match(app, /initialMessage: 'Force rebuilding preparation…'/);
  assert.match(app, /onRunNeededPreparation=\{handleRunNeededPreparation\}/);
  assert.match(app, /onForceFullPreparation=\{handleForceFullPreparation\}/);
  assert.match(mainContent, /onRunNeededPreparation: \(matterName: string, startStage\?: string\) => void/);
  assert.match(mainContent, /onForceFullPreparation: \(matterName: string, reason: string\) => void/);
  assert.match(homeLanding, /<MatterOverview onRunNeededPreparation=\{onRunNeededPreparation\} onForceFullPreparation=\{onForceFullPreparation\} \/>/);
  assert.match(overview, /Run needed preparation/);
  assert.match(overview, /Advanced: force full rebuild/);
  assert.match(overview, /Type REBUILD to confirm/);
  assert.match(overview, /forceReason\.trim\(\)\.length >= 10/);
  assert.match(overview, /onForceFullPreparation\(matterName, forceReason\)/);
  assert.match(overview, /api[\s\S]*\.getPrepareMatter\(matterName\)/);
  assert.doesNotMatch(overview, /\.getMatterStatus\(matterName\)/);
  assert.match(overview, /matter-preparation-title[\s\S]*Matter Preparation[\s\S]*preparationHeadlineLabel/);
  assert.match(overview, /matter-preparation-actions[\s\S]*Run needed preparation/);
  assert.match(overview, /const isPreparationRunning = preparationRun\?\.state === 'running'/);
  assert.match(overview, /disabled=\{isPreparationRunning\}/);
  assert.match(overview, /onRunNeededPreparation\(matterName\)/);
  assert.doesNotMatch(overview, /Run needed from here/);
  assert.match(preparationRowActions, /Refresh from Source Labels/);
  assert.match(preparationRowActions, /Refresh from Case Timeline/);
  assert.match(preparationRowActions, /Refresh from Matter Story/);
  assert.match(preparationRowActions, /Run saved Procedural Diagnosis/);
  assert.match(preparationRowActions, /Needs Case Timeline first/);
  assert.match(preparationRowActions, /Needs Matter Story first/);
  assert.match(overview, /getPreparationRowAction\(stage\)/);
  assert.match(overview, /preparationProgressStepForStage\(stage, preparationRun\)/);
  assert.match(overview, /progressStep\?\.state === 'running'\) return 'Running'/);
  assert.match(overview, /'\/procedural_posture_diagnosis'\) return 'procedural-posture-diagnosis'/);
  assert.match(overview, /onRunNeededPreparation\(matterName, startStage\)/);
  assert.match(overview, /stages\.some\(stageIsBlocked\)/);
  assert.match(overview, /isPreparationStageCurrent/);
  assert.match(preparationRowActions, /export function getPreparationRowAction/);
  assert.match(preparationRowActions, /stage\.state === 'current_unconfirmed'\) return false/);
  assert.match(overview, /Diagnosis has not been generated yet\. Use the Procedural Diagnosis row below to run and save it\./);
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

test("React automatic preparation sanitizes upstream HTML before showing failures", async () => {
  const runner = await readFile(runnerPath, "utf8");

  assert.match(runner, /import \{ formatVisiblePreparationError \} from '\.\/preparationErrors';/);
  assert.doesNotMatch(runner, /const message = error instanceof Error \? error\.message : String\(error\);/);
  assert.match(runner, /const message = formatVisiblePreparationError\(error, nextStage\);[\s\S]*markStageFailed\(status, nextStage, message\)/);
  assert.match(runner, /const message = formatVisiblePreparationError\(error, stage\);[\s\S]*markStageFailed\(next, stage, message\)/);
});

test("React automatic preparation suppresses failed-stage UI updates after the matter goes stale", async () => {
  const runner = await readFile(runnerPath, "utf8");

  assert.match(
    runner,
    /catch \(error\) \{[\s\S]*const message = formatVisiblePreparationError\(error, nextStage\);[\s\S]*status = markStageFailed\(status, nextStage, message\);[\s\S]*await recordStageTelemetry\([\s\S]*?\);\n\s+if \(isStale\(\)\) return finishWithTelemetry\(staleResult\(\), status\);\n\s+onProgress\(status\);[\s\S]*appendTerminal\(\[`\[prepare\] auto failed:/,
  );
});

test("React automatic preparation does not fail downstream blocked steps while an upstream step can run", async () => {
  const runner = await readFile(runnerPath, "utf8");

  assert.match(runner, /const nextStage = upstreamBlocker \? null : firstRunnablePreparationStage\(plan, startStage\)/);
  assert.match(runner, /mergePlanIntoStatus\(status, plan, \{ markBlocked: !nextStage \}\)/);
  assert.match(runner, /completePreparationAdvisory/);
  assert.match(runner, /markBlockedWhenNoRunnable: true/);
  assert.match(runner, /mergePlanIntoStatus\(advisoryStatus, finalPlan, \{ markBlocked: markBlockedWhenNoRunnable && !finalNextStage \}\)/);
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
  assert.match(overview, /Matter details are incomplete/);
  assert.match(overview, /formatMissingMatterDetails\(missingFields\)/);
  assert.match(overview, /preparationRefreshKey/);
  assert.match(overview, /<PipelineCard[\s\S]*refreshKey=\{preparationRefreshKey\}/);
  assert.match(overview, /<AttentionCard matterName=\{matter\.name\} refreshKey=\{preparationRefreshKey\} preparationRun=\{preparationRun\}/);
  assert.match(overview, /Preparing a fresh advisory\. The previous advisory will be replaced when this run finishes\./);
  assert.match(overview, /\}, \[matterName, refreshKey, isPreparing\]\)/);
  assert.match(overview, /preparationRun/);
  assert.match(overview, /function StageReason/);
  assert.match(overview, /pipeline-stage-reason/);
  assert.match(overview, /Output will appear after earlier preparation steps are current/);
  assert.doesNotMatch(overview, /Matter readiness/);
  assert.doesNotMatch(overview, /Developer attention/);
  assert.doesNotMatch(overview, /matter\.json/);
});

test("React prepare-matter empty state describes the full mandatory chain", async () => {
  const prepareMatter = await readFile(prepareMatterPath, "utf8");

  assert.match(prepareMatter, /Pick a matter first/);
  assert.match(prepareMatter, /set up the matter/i);
  assert.match(prepareMatter, /read documents/i);
  assert.match(prepareMatter, /label sources/i);
  assert.match(prepareMatter, /build the Case Timeline/i);
  assert.match(prepareMatter, /check the advisory/i);
  assert.doesNotMatch(prepareMatter, /metadata check, extraction, and source labeling/);
});
