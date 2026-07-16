import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const overviewPath = new URL("../react-ui/src/views/MatterOverview.tsx", import.meta.url);
const backendPreparationHookPath = new URL("../react-ui/src/hooks/useBackendPreparationJobs.ts", import.meta.url);
const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);

test("Matter Overview observes backend preparation jobs through a dedicated hook", async () => {
  const overview = await readFile(overviewPath, "utf8");
  const hook = await readFile(backendPreparationHookPath, "utf8");

  assert.match(overview, /import \{ useBackendPreparationJobs \} from '\.\.\/hooks\/useBackendPreparationJobs'/);
  assert.doesNotMatch(overview, /api\.getJobs\(\{ matterName, limit: 50 \}\)/);
  assert.match(overview, /hasBackendPreparationFailure=\{backendPreparation\.hasFailedJob\}/);
  assert.match(overview, /disabled=\{isPreparationRunning\}/);

  assert.match(hook, /export function useBackendPreparationJobs/);
  assert.match(hook, /api\.getJobs\(\{ matterName, limit: 50 \}\)/);
  assert.match(hook, /PREPARATION_JOB_KINDS = \['matter_init', 'extract', 'source_labels', 'case_timeline', 'matter_story', 'posture_diagnosis'\]/);
  assert.match(hook, /ACTIVE_PREPARATION_JOB_STATUSES = new Set\(\['queued', 'running', 'retrying'\]\)/);
  assert.match(hook, /preparationRunFromBackendJobs\(matterName, jobs\)/);
  assert.match(hook, /formatPreparationStatusError\(e\)/);
  assert.match(hook, /Preparation running on server… You can refresh; progress is kept in Activity\./);
});

test("backend preparation hook refreshes after observed server work completes", async () => {
  const overview = await readFile(overviewPath, "utf8");
  const hook = await readFile(backendPreparationHookPath, "utf8");

  assert.match(hook, /sawActiveBackendJob = true/);
  assert.match(hook, /server preparation finished; refreshing matter workspace/);
  assert.match(hook, /refreshActiveMatterWorkspace\(\{[\s\S]*expectedMatterName: matterName,[\s\S]*failurePrefix: '\[workspace\] refresh failed after server preparation'/);
  assert.match(hook, /sawPollError = true/);
  assert.match(hook, /recoveredFromPollError/);
  assert.match(hook, /setRefreshSeq\(\(seq\) => seq \+ 1\)/);
  assert.match(overview, /backendPreparation\.refreshKey/);
  assert.match(overview, /error && !backendJobsError/);
  assert.doesNotMatch(overview, /Server preparation status is unavailable:/);
});

test("Matter Overview presents backend preparation failures without receiving raw failed jobs", async () => {
  const overview = await readFile(overviewPath, "utf8");
  const hook = await readFile(backendPreparationHookPath, "utf8");

  assert.match(hook, /hasLatestPreparationFailure/);
  assert.match(hook, /hasFailedJob: activeJobs\.length === 0 && hasLatestPreparationFailure\(jobs\)/);
  assert.match(overview, /hasBackendPreparationFailure && !isPreparationRunning/);
  assert.match(overview, /A server preparation job stopped before finishing\. Open Activity for details, then run needed preparation again\./);
  assert.doesNotMatch(overview, /latestBackendFailure|latestPreparationFailure/);
  assert.doesNotMatch(overview, /backendPreparation\.(?:errorMessage|summary)/);
  assert.doesNotMatch(overview, /hasBackendPreparationFailure\.(?:errorMessage|summary)/);
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
