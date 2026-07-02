import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const matterWorkflowRoutesPath = new URL("../routes/matter-workflow-routes.mjs", import.meta.url);

async function readRouteSource(startMarker, endMarker) {
  const source = await readFile(matterWorkflowRoutesPath, "utf8");
  const routeStart = source.indexOf(startMarker);
  const nextRouteStart = source.indexOf(endMarker, routeStart);

  assert.notEqual(routeStart, -1);
  assert.notEqual(nextRouteStart, -1);

  return source.slice(routeStart, nextRouteStart);
}

test("runtime DB setup and analysis write routes stay DB-native", async () => {
  const initSource = await readRouteSource(
    'exactRoute("POST", "/api/matter-init"',
    'exactRoute("POST", "/api/extract"',
  );
  const extractSource = await readRouteSource(
    'exactRoute("POST", "/api/extract"',
    'exactRoute("POST", "/api/describe-sources"',
  );
  const labelsSource = await readRouteSource(
    'exactRoute("POST", "/api/describe-sources"',
    'exactRoute("POST", "/api/create-listofdates"',
  );
  const listSource = await readRouteSource(
    'exactRoute("POST", "/api/create-listofdates"',
    'exactRoute("POST", "/api/create-listofdates/refresh-labels"',
  );
  const refreshSource = await readRouteSource(
    'exactRoute("POST", "/api/create-listofdates/refresh-labels"',
    'exactRoute("POST", "/api/matter-story"',
  );

  assert.match(initSource, /assertRuntimeDbMatterInitAvailable/);
  assert.match(initSource, /initializeMatter/);
  assert.doesNotMatch(initSource, /runRuntimeDbMaterializedWorkflow/);
  assert.doesNotMatch(initSource, /runMaterializedMatterWrite/);

  assert.match(extractSource, /assertRuntimeDbExtractAvailable/);
  assert.match(extractSource, /extractDocuments/);
  assert.doesNotMatch(extractSource, /runRuntimeDbMaterializedWorkflow/);
  assert.doesNotMatch(extractSource, /runMaterializedMatterWrite/);

  assert.match(labelsSource, /assertRuntimeDbSourceDescriptorsAvailable/);
  assert.match(labelsSource, /describeSources/);
  assert.doesNotMatch(labelsSource, /runRuntimeDbMaterializedWorkflow/);
  assert.doesNotMatch(labelsSource, /runMaterializedMatterWrite/);

  assert.match(listSource, /assertRuntimeDbCreateListOfDatesAvailable/);
  assert.match(listSource, /createListOfDates/);
  assert.doesNotMatch(listSource, /runRuntimeDbMaterializedWorkflow/);
  assert.doesNotMatch(listSource, /runMaterializedMatterWrite/);

  assert.match(refreshSource, /assertRuntimeDbListOfDatesLabelRefreshAvailable/);
  assert.match(refreshSource, /refreshListOfDatesSourceLabels/);
  assert.doesNotMatch(refreshSource, /runRuntimeDbMaterializedWorkflow/);
  assert.doesNotMatch(refreshSource, /runMaterializedMatterWrite/);
});

test("runtime DB matter story route stays DB-native", async () => {
  const routeSource = await readRouteSource(
    'exactRoute("POST", "/api/matter-story"',
    'exactRoute("POST", "/api/doctor/scan"',
  );
  const fullSource = await readFile(matterWorkflowRoutesPath, "utf8");
  const helperSource = fullSource.slice(
    fullSource.indexOf("async function matterStoryRunnerRequest"),
    fullSource.indexOf("async function runProceduralPostureDiagnosisSkill"),
  );

  assert.match(routeSource, /runMatterStorySkill/);
  assert.match(helperSource, /assertRuntimeDbMatterStoryAvailable/);
  assert.match(helperSource, /readMatterContextPacket/);
  assert.match(helperSource, /readMatterJson/);
  assert.match(helperSource, /persistTextArtifacts/);
  assert.match(helperSource, /persistMatterJson/);
  assert.doesNotMatch(helperSource, /runRuntimeDbMaterializedWorkflow/);
  assert.doesNotMatch(helperSource, /runMaterializedMatterWrite/);
  assert.doesNotMatch(helperSource, /matterRootOverride: matterRoot/);
});

test("runtime DB doctor read and fix routes stay DB-native", async () => {
  const scanSource = await readRouteSource(
    'exactRoute("POST", "/api/doctor/scan"',
    'exactRoute("POST", "/api/doctor/fix"',
  );
  const fixSource = await readRouteSource(
    'exactRoute("POST", "/api/doctor/fix"',
    'exactRoute("GET", "/api/matter-status"',
  );

  assert.match(scanSource, /assertRuntimeDbDoctorScanAvailable/);
  assert.match(scanSource, /readDoctorScan/);
  assert.doesNotMatch(scanSource, /runRuntimeDbMaterializedRead/);
  assert.doesNotMatch(scanSource, /runMaterializedMatterRead/);

  assert.match(fixSource, /assertRuntimeDbDoctorFixAvailable/);
  assert.match(fixSource, /fixDoctorIssues/);
  assert.doesNotMatch(fixSource, /runRuntimeDbMaterializedWorkflow/);
  assert.doesNotMatch(fixSource, /runMaterializedMatterWrite/);
});

test("runtime DB matter context and rerun advice read routes stay DB-native", async () => {
  const previewSource = await readRouteSource(
    'exactRoute("GET", "/api/source-removal-impact-preview"',
    'exactRoute("GET", "/api/matter-context/search"',
  );
  const searchSource = await readRouteSource(
    'exactRoute("GET", "/api/matter-context/search"',
    'exactRoute("GET", "/api/matter-context"',
  );
  const contextSource = await readRouteSource(
    'exactRoute("GET", "/api/matter-context"',
    'exactRoute("POST", "/api/matter-copilot/answer"',
  );
  const copilotSource = await readRouteSource(
    'exactRoute("POST", "/api/matter-copilot/answer"',
    'exactRoute("GET", "/api/rerun-advice"',
  );
  const adviceSource = await readRouteSource(
    'exactRoute("GET", "/api/rerun-advice"',
    "    ],\n  });\n}",
  );

  assert.match(previewSource, /assertRuntimeDbContextReadAvailable/);
  assert.match(previewSource, /readMatterContextPacket/);
  assert.match(previewSource, /buildSourceRemovalImpactPreviewFromPacket/);
  assert.match(previewSource, /return;\n\s*}\n\s*assertFilesystemWorkflowAvailable/);
  assert.doesNotMatch(previewSource, /runRuntimeDbMaterializedRead/);
  assert.doesNotMatch(previewSource, /runMaterializedMatterRead/);

  assert.match(searchSource, /assertRuntimeDbContextReadAvailable/);
  assert.match(searchSource, /readMatterContextPacket/);
  assert.doesNotMatch(searchSource, /runRuntimeDbMaterializedRead/);
  assert.doesNotMatch(searchSource, /runMaterializedMatterRead/);

  assert.match(contextSource, /assertRuntimeDbContextReadAvailable/);
  assert.match(contextSource, /readMatterContextPacket/);
  assert.doesNotMatch(contextSource, /runRuntimeDbMaterializedRead/);
  assert.doesNotMatch(contextSource, /runMaterializedMatterRead/);

  assert.match(copilotSource, /assertRuntimeDbCopilotContextAvailable/);
  assert.match(copilotSource, /answerQuestionFromPacket/);
  assert.doesNotMatch(copilotSource, /runRuntimeDbMaterializedRead/);
  assert.doesNotMatch(copilotSource, /runMaterializedMatterRead/);

  assert.match(adviceSource, /assertRuntimeDbRerunAdviceAvailable/);
  assert.match(adviceSource, /readRerunAdvice/);
  assert.doesNotMatch(adviceSource, /runRuntimeDbMaterializedRead/);
  assert.doesNotMatch(adviceSource, /runMaterializedMatterRead/);
});
