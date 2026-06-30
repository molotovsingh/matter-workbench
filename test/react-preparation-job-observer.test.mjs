import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const overviewPath = new URL("../react-ui/src/views/MatterOverview.tsx", import.meta.url);
const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);

test("Matter Overview observes backend preparation jobs after refresh", async () => {
  const source = await readFile(overviewPath, "utf8");

  assert.match(source, /function useBackendPreparationJobs/);
  assert.match(source, /api\.getJobs\(\{ matterName, limit: 50 \}\)/);
  assert.match(source, /PREPARATION_JOB_KINDS = \['matter_init', 'extract', 'source_labels', 'case_timeline', 'matter_story', 'posture_diagnosis'\]/);
  assert.match(source, /ACTIVE_PREPARATION_JOB_STATUSES = new Set\(\['queued', 'running', 'retrying'\]\)/);
  assert.match(source, /preparationRunFromBackendJobs\(matterName, jobs\)/);
  assert.match(source, /Preparation running on server… You can refresh; progress is kept in Activity\./);
  assert.match(source, /disabled=\{isPreparationRunning\}/);
});

test("Matter Overview refreshes after backend preparation completes", async () => {
  const source = await readFile(overviewPath, "utf8");

  assert.match(source, /sawActiveBackendJob = true/);
  assert.match(source, /server preparation finished; refreshing matter workspace/);
  assert.match(source, /refreshActiveMatterWorkspace\(\{[\s\S]*expectedMatterName: matterName,[\s\S]*failurePrefix: '\[workspace\] refresh failed after server preparation'/);
  assert.match(source, /setRefreshSeq\(\(seq\) => seq \+ 1\)/);
  assert.match(source, /backendPreparation\.refreshKey/);
});

test("Matter Overview presents backend preparation failures without raw error text", async () => {
  const source = await readFile(overviewPath, "utf8");

  assert.match(source, /latestPreparationFailure/);
  assert.match(source, /A server preparation job stopped before finishing\. Open Activity for details, then run needed preparation again\./);
  assert.doesNotMatch(source, /latestBackendFailure\.(?:errorMessage|summary)/);
});

test("React API client supports filtered job reads for preparation observers", async () => {
  const source = await readFile(apiClientPath, "utf8");

  assert.match(source, /type JobListQuery = number \| \{/);
  assert.match(source, /matterName\?: string/);
  assert.match(source, /kind\?: string/);
  assert.match(source, /status\?: string/);
  assert.match(source, /getJobs: \(query: JobListQuery = 100\)/);
  assert.match(source, /withQuery\('\/api\/jobs'/);
});
