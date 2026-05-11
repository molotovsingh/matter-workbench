import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
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
  assert.deepEqual(created.idea, {
    id: "idea_test_1",
    text: "create a skill to summarize pleadings",
    createdAt: "2026-05-12T10:00:00.000Z",
    updatedAt: "2026-05-12T10:00:00.000Z",
    status: "proposed",
    matter: {
      matterName: "Mehta vs Skyline",
      folderName: "Mehta vs Skyline",
    },
    designBrief: EMPTY_DESIGN_BRIEF,
  });

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
  assert.equal(updated.idea.status, "proposed");
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

  const listed = await service.listIdeas();
  assert.deepEqual(listed.ideas[0].designBrief, updated.idea.designBrief);
});

test("skill ideas service updates proposal status without changing text", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "matter-skill-ideas-"));
  let tick = 0;
  const timestamps = [
    "2026-05-12T10:00:00.000Z",
    "2026-05-12T10:05:00.000Z",
  ];
  const service = createSkillIdeasService({
    appDir,
    now: () => new Date(timestamps[tick++]),
    idFactory: () => "idea_test_2",
  });

  await service.createIdea({ text: "new skill bundle exhibits" });
  const updated = await service.updateIdeaStatus("idea_test_2", "marked_for_future");

  assert.equal(updated.idea.status, "marked_for_future");
  assert.equal(updated.idea.text, "new skill bundle exhibits");
  assert.equal(updated.idea.updatedAt, "2026-05-12T10:05:00.000Z");
  assert.deepEqual(updated.idea.designBrief, EMPTY_DESIGN_BRIEF);
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
    () => service.updateIdeaStatus("idea_missing", "marked_for_future"),
    /Skill idea not found/,
  );
  await assert.rejects(
    () => service.updateIdeaStatus("idea_missing", "active"),
    /Invalid skill idea status/,
  );
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
