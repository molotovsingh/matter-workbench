import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  calculateSkillIdeaReadiness,
  createSkillIdeasService,
  SKILL_IDEAS_SCHEMA_VERSION,
} from "../services/skill-ideas-service.mjs";

const EMPTY_DESIGN_BRIEF = {
  intendedUser: "",
  problem: "",
  expectedInputs: "",
  expectedOutputArtifact: "",
  targetLane: "",
  paidPosture: "",
  riskLevel: "",
  notes: "",
};

test("skill ideas service creates and lists app-level proposal records", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-skill-ideas-"));
  const service = createSkillIdeasService({
    appDir,
    now: () => new Date("2026-05-12T10:00:00.000Z"),
    idFactory: () => "idea_test_1",
  });

  const created = await service.createIdea({
    text: "  create a skill to summarize pleadings  ",
    matter: {
      matterName: "Mehta vs Skyline",
      folderName: "Mehta vs Skyline",
    },
  });

  assert.equal(created.schema_version, SKILL_IDEAS_SCHEMA_VERSION);
  assert.equal(created.idea.id, "idea_test_1");
  assert.equal(created.idea.text, "create a skill to summarize pleadings");
  assert.equal(created.idea.createdAt, "2026-05-12T10:00:00.000Z");
  assert.equal(created.idea.updatedAt, "2026-05-12T10:00:00.000Z");
  assert.equal(created.idea.status, "incomplete");
  assert.deepEqual(created.idea.matter, {
    matterName: "Mehta vs Skyline",
    folderName: "Mehta vs Skyline",
  });
  assert.deepEqual(created.idea.designBrief, EMPTY_DESIGN_BRIEF);
  assert.equal(created.idea.readiness.ready, false);
  assert.equal(created.idea.readiness.passedCount, 0);

  const listed = await service.listIdeas();
  assert.equal(listed.schema_version, SKILL_IDEAS_SCHEMA_VERSION);
  assert.deepEqual(listed.ideas, [created.idea]);

  const stored = JSON.parse(await readFile(path.join(appDir, "skill-ideas.json"), "utf8"));
  assert.equal(stored.schema_version, SKILL_IDEAS_SCHEMA_VERSION);
  assert.equal(stored.ideas[0].text, "create a skill to summarize pleadings");
});

test("skill ideas service saves and reloads design brief fields without changing proposal text", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-skill-ideas-"));
  let tick = 0;
  const timestamps = [
    "2026-05-12T10:00:00.000Z",
    "2026-05-12T10:10:00.000Z",
  ];
  const service = createSkillIdeasService({
    appDir,
    now: () => new Date(timestamps[tick++]),
    idFactory: () => "idea_test_3",
  });

  await service.createIdea({ text: "create a skill to prepare issue-wise pleadings summary" });
  const updated = await service.updateIdeaDesignBrief("idea_test_3", {
    intendedUser: "Litigation associate",
    problem: "Turn pleadings into issue-wise review notes.",
    expectedInputs: "Pleadings, replies, and annexures.",
    expectedOutputArtifact: "20_Workshop/Issue-wise Pleadings Summary.md",
    targetLane: "20_Workshop",
    paidPosture: "paid",
    riskLevel: "medium",
    notes: "Design only. Not runnable yet.",
  });

  assert.equal(updated.schema_version, SKILL_IDEAS_SCHEMA_VERSION);
  assert.equal(updated.idea.text, "create a skill to prepare issue-wise pleadings summary");
  assert.equal(updated.idea.status, "incomplete");
  assert.equal(updated.idea.updatedAt, "2026-05-12T10:10:00.000Z");
  assert.deepEqual(updated.idea.designBrief, {
    intendedUser: "Litigation associate",
    problem: "Turn pleadings into issue-wise review notes.",
    expectedInputs: "Pleadings, replies, and annexures.",
    expectedOutputArtifact: "20_Workshop/Issue-wise Pleadings Summary.md",
    targetLane: "20_Workshop",
    paidPosture: "paid",
    riskLevel: "medium",
    notes: "Design only. Not runnable yet.",
  });
  assert.equal(updated.idea.readiness.ready, true);
  assert.equal(updated.idea.readiness.passedCount, 8);

  const listed = await service.listIdeas();
  assert.deepEqual(listed.ideas[0].designBrief, updated.idea.designBrief);
  assert.equal(listed.ideas[0].readiness.ready, true);
});

test("skill ideas service gates ready-for-review status on complete design brief", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-skill-ideas-"));
  let tick = 0;
  const timestamps = [
    "2026-05-12T10:00:00.000Z",
    "2026-05-12T10:05:00.000Z",
    "2026-05-12T10:10:00.000Z",
  ];
  const service = createSkillIdeasService({
    appDir,
    now: () => new Date(timestamps[tick++]),
    idFactory: () => "idea_test_2",
  });

  await service.createIdea({ text: "new skill bundle exhibits" });
  await assert.rejects(
    () => service.updateIdeaStatus("idea_test_2", "ready_for_review"),
    /Skill idea is not ready for review/,
  );
  await service.updateIdeaDesignBrief("idea_test_2", {
    intendedUser: "Litigation associate",
    problem: "Bundle exhibits for dispatch review.",
    expectedInputs: "Selected exhibits.",
    expectedOutputArtifact: "40_Dispatch/Exhibit Bundle Index.md",
    targetLane: "40_Dispatch",
    paidPosture: "free",
    riskLevel: "low",
    notes: "Acceptance: reviewed index with source citations.",
  });
  const updated = await service.updateIdeaStatus("idea_test_2", "ready_for_review");

  assert.equal(updated.idea.status, "ready_for_review");
  assert.equal(updated.idea.text, "new skill bundle exhibits");
  assert.equal(updated.idea.updatedAt, "2026-05-12T10:10:00.000Z");
  assert.equal(updated.idea.readiness.ready, true);
});

test("skill ideas service rejects blank text and invalid statuses", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-skill-ideas-"));
  const service = createSkillIdeasService({ appDir });

  await assert.rejects(
    () => service.createIdea({ text: " " }),
    /Skill idea text is required/,
  );
  await service.createIdea({ text: "can we make a skill for limitation review" });
  await assert.rejects(
    () => service.updateIdeaStatus("idea_missing", "parked"),
    /Skill idea not found/,
  );
  await assert.rejects(
    () => service.updateIdeaStatus("idea_missing", "active"),
    /Invalid skill idea status/,
  );
});

test("skill ideas service parks ideas and migrates legacy statuses on read", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-skill-ideas-"));
  const ideasPath = path.join(appDir, "skill-ideas.json");
  await writeFile(ideasPath, `${JSON.stringify({
    schema_version: SKILL_IDEAS_SCHEMA_VERSION,
    ideas: [
      {
        id: "legacy_proposed",
        text: "legacy proposal",
        createdAt: "2026-05-12T10:00:00.000Z",
        updatedAt: "2026-05-12T10:00:00.000Z",
        status: "proposed",
      },
      {
        id: "legacy_future",
        text: "legacy future idea",
        createdAt: "2026-05-12T10:01:00.000Z",
        updatedAt: "2026-05-12T10:01:00.000Z",
        status: "marked_for_future",
      },
    ],
  }, null, 2)}\n`);
  const service = createSkillIdeasService({ appDir, ideasPath });
  const listed = await service.listIdeas();

  assert.equal(listed.ideas.find((idea) => idea.id === "legacy_proposed").status, "incomplete");
  assert.equal(listed.ideas.find((idea) => idea.id === "legacy_future").status, "parked");

  const parked = await service.updateIdeaStatus("legacy_proposed", "parked");
  assert.equal(parked.idea.status, "parked");
});

test("skill idea readiness calculation checks every required brief field", () => {
  const incomplete = calculateSkillIdeaReadiness({
    intendedUser: "Litigation associate",
    targetLane: "20_Workshop",
  });
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.passedCount, 2);
  assert.equal(incomplete.items.length, 8);
  assert.ok(incomplete.items.some((item) => item.key === "notes" && !item.passed));

  const ready = calculateSkillIdeaReadiness({
    intendedUser: "Litigation associate",
    problem: "Prepare issue notes.",
    expectedInputs: "Pleadings.",
    expectedOutputArtifact: "20_Workshop/Issue Notes.md",
    targetLane: "20_Workshop",
    paidPosture: "unknown",
    riskLevel: "medium",
    notes: "Acceptance: issue-wise output.",
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.state, "ready_for_review");
  assert.equal(ready.passedCount, 8);
});

test("skill ideas service rejects invalid design brief enum values", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-skill-ideas-"));
  const service = createSkillIdeasService({
    appDir,
    idFactory: () => "idea_test_4",
  });

  await service.createIdea({ text: "I need a skill that reviews limitation" });
  await assert.rejects(
    () => service.updateIdeaDesignBrief("idea_test_4", { targetLane: "50_Unknown" }),
    /Invalid skill idea design brief target lane/,
  );
  await assert.rejects(
    () => service.updateIdeaDesignBrief("idea_test_4", { paidPosture: "maybe" }),
    /Invalid skill idea design brief paid\/free posture/,
  );
  await assert.rejects(
    () => service.updateIdeaDesignBrief("idea_test_4", { riskLevel: "urgent" }),
    /Invalid skill idea design brief risk level/,
  );
});
