import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runMatterInit } from "../matter-init-engine.mjs";
import { createWorkbenchServer } from "../server.mjs";

async function postJson(baseUrl, pathName, body = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

test("server API smoke test keeps public routes stable", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-api-test-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Smoke Matter");
  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files"), { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files", "note.txt"), "Smoke event on 20 April 2026.");
  await runMatterInit({
    matterRoot,
    dryRun: false,
    metadata: {
      clientName: "Smoke",
      matterName: "Smoke Matter",
      oppositeParty: "Opposite",
      matterType: "Test",
      jurisdiction: "Local",
      briefDescription: "",
    },
  });

  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    skillRegistryPath: path.join(process.cwd(), "skills", "registry.json"),
    aiProvider: async () => ({
      entries: [{
        date_iso: "2026-04-20",
        date_text: "20 April 2026",
        event: "Smoke event occurred.",
        citation: "FILE-0001 p1.b1",
        needs_review: false,
        confidence: 0.9,
      }],
    }),
    skillRouterProvider: async () => ({
      decision: "modify_existing_skill",
      recommended_action: "modify_existing_skill",
      matched_skill: "/create_listofdates",
      confidence: 0.92,
      reason: "The request overlaps with /create_listofdates.",
      user_gate_required: false,
      suggested_next_action: "Ask for approval to modify /create_listofdates.",
      mece_violation: true,
      legal_setting: {
        jurisdiction: "",
        forum: "",
        case_type: "",
        procedure_stage: "",
        side: "",
        relief_type: "",
      },
      override_requires: ["distinct output contract"],
    }),
  });

  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  try {
    const config = await getJson(baseUrl, "/api/config");
    assert.equal(config.mattersHome, mattersHome);
    const matters = await getJson(baseUrl, "/api/matters");
    assert.deepEqual(matters.matters, [{ name: "Smoke Matter" }]);
    const switched = await postJson(baseUrl, "/api/switch-matter", { name: "Smoke Matter" });
    assert.equal(switched.folderName, "Smoke Matter");
    const workspace = await getJson(baseUrl, "/api/workspace");
    assert.equal(workspace.metadata.matterName, "Smoke Matter");
    const extract = await postJson(baseUrl, "/api/extract", { dryRun: false });
    assert.equal(extract.counts.extracted, 1);
    const listOfDates = await postJson(baseUrl, "/api/create-listofdates", { dryRun: false });
    assert.equal(listOfDates.counts.entries, 1);
    assert.equal(listOfDates.entries[0].citation, "FILE-0001 p1.b1");
    const skills = await getJson(baseUrl, "/api/skills");
    assert.ok(skills.skills.some((skill) => skill.slash === "/create_listofdates"));
    const skillIntent = await postJson(baseUrl, "/api/skills/check-intent", {
      userRequest: "Create a new list of dates skill",
    });
    assert.equal(skillIntent.decision, "needs_user_approval");
    assert.equal(skillIntent.matched_skill, "/create_listofdates");
    const doctor = await postJson(baseUrl, "/api/doctor/scan");
    assert.deepEqual(doctor.issues, []);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test("overlap check reads file registers from every intake folder", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-overlap-test-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Two Intake Matter");
  const firstHash = "a".repeat(64);
  const secondHash = "b".repeat(64);

  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial"), { recursive: true });
  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 02 - Follow Up"), { recursive: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(
    path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "File Register.csv"),
    `file_id,sha256\nFILE-0001,${firstHash}\n`,
  );
  await writeFile(
    path.join(matterRoot, "00_Inbox", "Intake 02 - Follow Up", "File Register.csv"),
    `file_id,sha256\nFILE-0002,${secondHash}\n`,
  );

  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    skillRegistryPath: path.join(process.cwd(), "skills", "registry.json"),
  });

  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  try {
    const result = await postJson(baseUrl, "/api/matters/check-overlap", {
      hashes: [secondHash],
    });
    assert.deepEqual(result.warnings, [{
      matterName: "Two Intake Matter",
      overlapCount: 1,
      totalIncoming: 1,
      matterTotalFiles: 2,
      overlapPercent: 100,
    }]);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});
