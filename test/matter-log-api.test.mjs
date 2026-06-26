import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkbenchServer } from "../server.mjs";

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

test("/api/matter-log exposes read-only best-effort Matter Log projection", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-matter-log-api-"));
  const appDir = path.join(tmp, "app");
  await mkdir(appDir, { recursive: true });

  const seen = [];
  const app = await createWorkbenchServer({
    appDir,
    env: {},
    host: "127.0.0.1",
    port: 0,
    matterLogService: {
      readMatterLog: async (query) => {
        seen.push(query);
        return {
          schema_version: "matter-log/v0-readonly",
          status: "best_effort_projection",
          generatedAt: "2026-06-26T12:00:00.000Z",
          matterName: query.matterName,
          summary: { entries: 1, sourceLedgers: ["job_status"], canonicalEvents: false },
          limitations: ["This is a read-only projection from existing ledgers, not a canonical matter event ledger."],
          entries: [{
            id: "job:job_1",
            sourceLedger: "job_status",
            sourceId: "job_1",
            occurredAt: "2026-06-26T11:00:00.000Z",
            matterName: query.matterName,
            category: "source_preparation",
            eventType: "job.extract.succeeded",
            title: "Extract Documents",
            summary: "Extracted documents.",
            status: "succeeded",
            custodyGrade: "projection",
            canonical: false,
          }],
        };
      },
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const log = await getJson(baseUrl, "/api/matter-log?matter=Taori%20vs%20Roma%20Builder&limit=7");

    assert.deepEqual(seen, [{ matterName: "Taori vs Roma Builder", limit: "7" }]);
    assert.equal(log.schema_version, "matter-log/v0-readonly");
    assert.equal(log.status, "best_effort_projection");
    assert.equal(log.summary.canonicalEvents, false);
    assert.equal(log.entries[0].custodyGrade, "projection");
    assert.equal(log.entries[0].canonical, false);
  } finally {
    app.server.close();
  }
});
