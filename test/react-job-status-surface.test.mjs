import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);
const activityPagePath = new URL("../react-ui/src/views/ActivityPage.tsx", import.meta.url);
const typesPath = new URL("../react-ui/src/types/index.ts", import.meta.url);

test("React API client exposes durable job status reads", async () => {
  const source = await readFile(apiClientPath, "utf8");
  assert.match(source, /getJobs:/);
  assert.match(source, /\/api\/jobs/);
});

test("Activity page renders durable jobs separately from custom skill receipts", async () => {
  const source = await readFile(activityPagePath, "utf8");
  assert.match(source, /getJobs/);
  assert.match(source, /Matter Jobs/);
  assert.match(source, /JobCard/);
  assert.match(source, /job\.kind/);
});

test("React types include the beta job status contract", async () => {
  const source = await readFile(typesPath, "utf8");
  assert.match(source, /export interface JobStatus/);
  assert.match(source, /schema_version\?: 'job-status\/v1'/);
  assert.match(source, /export interface JobStatusList/);
});
