import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const activityPagePath = new URL("../react-ui/src/views/ActivityPage.tsx", import.meta.url);
const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);
const typesPath = new URL("../react-ui/src/types/index.ts", import.meta.url);


test("React API client exposes the read-only Matter Log projection endpoint", async () => {
  const client = await readFile(apiClientPath, "utf8");
  const types = await readFile(typesPath, "utf8");

  assert.match(types, /export interface MatterLogEntry/);
  assert.match(types, /sourceLedger: 'matter_events' \| 'job_status' \| 'configurable_skill_runs'/);
  assert.match(types, /custodyGrade: 'canonical_event' \| 'projection'/);
  assert.match(types, /canonical: boolean/);
  assert.match(types, /export interface MatterLog/);
  assert.match(client, /getMatterLog: \(limit = 100, matterName\?: string\) => getJson<MatterLog>/);
  assert.match(client, /\/api\/matter-log/);
});

test("Activity page labels Matter Log as a best-effort preview, not custody evidence", async () => {
  const source = await readFile(activityPagePath, "utf8");

  assert.match(source, /api\.getMatterLog\(100\)/);
  assert.match(source, /Matter Log/);
  assert.match(source, /Preview/);
  assert.match(source, /Best-effort projection from job and custom skill ledgers/);
  assert.match(source, /Not a custody-grade event log yet/);
  assert.match(source, /conversation memory is not evidence/i);
  assert.match(source, /Projection details/);
  assert.match(source, /canonical event/);
  assert.match(source, /Canonical event/);
});
