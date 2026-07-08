import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkbenchServer } from "../server.mjs";
import {
  MW_LIST_OF_DATES_JSON_RELATIVE,
  MW_LIST_OF_DATES_OUTPUT_RELATIVE,
} from "../services/mw-list-of-dates-service.mjs";
import {
  PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE,
  PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE,
} from "../services/procedural-posture-diagnosis-service.mjs";

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error || JSON.stringify(payload));
  return payload;
}

async function postJson(baseUrl, pathName, body = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error || JSON.stringify(payload));
  return payload;
}

async function writeFixtureMatter(mattersHome) {
  const matterRoot = path.join(mattersHome, "MW LOD API Matter");
  await mkdir(path.join(matterRoot, "10_Library"), { recursive: true });
  await mkdir(path.join(matterRoot, "20_Workshop", "Case Analysis"), { recursive: true });
  await writeJson(matterRoot, "matter.json", {
    matter_name: "MW LOD API Matter",
    client_name: "Client",
    opposite_party: "Opponent",
  });
  await writeJson(matterRoot, "10_Library/Source Index.json", {
    schema_version: "source-index/v1",
    sources: [{ file_id: "FILE-0001", display_label: "Demand Notice", short_label: "Demand Notice" }],
  });
  await writeJson(matterRoot, "10_Library/Case Timeline.json", {
    schema_version: "list-of-dates/v1",
    entries: [{
      date_iso: "2026-01-01",
      date_text: "1 Jan 2026",
      event: "Demand notice issued.",
      event_type: "notice",
      legal_relevance: "Notice before action.",
      citation: "FILE-0001 p1.b1",
      source_label: "Demand Notice",
    }],
  });
  await writeFile(path.join(matterRoot, "10_Library", "Case Timeline.md"), "# Case Timeline\n\n| Date | Event | Legal Relevance | Source |\n| --- | --- | --- | --- |\n| 2026-01-01 | Demand notice issued. | Notice before action. | Demand Notice |\n");
  await writeFile(path.join(matterRoot, "20_Workshop", "The Story.md"), "# The Story\n\nA demand notice anchors the contemplated filing.\n");
  await writeFile(path.join(matterRoot, PROCEDURAL_POSTURE_DIAGNOSIS_OUTPUT_RELATIVE), "# Filing and Procedural Posture Diagnosis\n\nWorking path: civil recovery suit.\n");
  await writeJson(matterRoot, PROCEDURAL_POSTURE_DIAGNOSIS_JSON_RELATIVE, {
    schema_version: "procedural-posture-diagnosis/v1",
    matter: { name: "MW LOD API Matter", client_side: "claimant" },
    court_forum: { value: "Commercial Court" },
    procedural_posture: { value: "Pre-filing" },
    recommended_working_path: { client_side: "claimant", filing_or_remedy: "civil recovery suit", reason: "Demand notice supports filing narrative." },
    governing_law: [{ text: "Contract Act / CPC" }],
    adverse_or_difficult_facts: [],
    missing_information: [],
    confirmation: { state: "confirmed", confirmed_at: "2026-07-01T00:00:00.000Z", actor: "tester" },
  });
  return matterRoot;
}

async function writeJson(root, relativePath, value) {
  const absolute = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

test("MW List of Dates API exposes status and writes Case Analysis artifacts", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mw-lod-api-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  await mkdir(appDir, { recursive: true });
  const matterRoot = await writeFixtureMatter(mattersHome);
  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    mwListOfDatesProvider: async () => ({
      rows: [{
        case_timeline_row_ids: ["CT-0001"],
        treatment: "central",
        framed_event: "Demand notice issued.",
        relevance_to_working_posture: "Central to the pre-suit chronology.",
        needs_lawyer_review: false,
        review_reason: "",
      }],
      adverse_or_difficult_facts: [],
      facts_considered_but_not_emphasized: [],
      missing_information_or_documents: [],
    }),
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { port } = app.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const status = await getJson(baseUrl, `/api/mw-list-of-dates/status?matter=${encodeURIComponent("MW LOD API Matter")}`);
    assert.equal(status.state, "ready_to_generate");

    const result = await postJson(baseUrl, "/api/mw-list-of-dates", { matterName: "MW LOD API Matter", overwrite: true });
    assert.equal(result.state, "written");
    assert.equal(result.artifactPath, MW_LIST_OF_DATES_OUTPUT_RELATIVE);
    assert.equal(result.job.metadata.skill.slash, "/create_mw_listofdates");

    const markdown = await readFile(path.join(matterRoot, ...MW_LIST_OF_DATES_OUTPUT_RELATIVE.split("/")), "utf8");
    assert.match(markdown, /MW List of Dates/);
    assert.doesNotMatch(markdown, /FILE-0001/);
    const sidecar = JSON.parse(await readFile(path.join(matterRoot, ...MW_LIST_OF_DATES_JSON_RELATIVE.split("/")), "utf8"));
    assert.equal(sidecar.rows[0].case_timeline_row_ids[0], "CT-0001");
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});
