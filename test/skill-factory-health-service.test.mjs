import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSkillFactoryHealthService } from "../services/skill-factory-health-service.mjs";
import { hashDesignBrief } from "../services/skill-samples-service.mjs";

test("skill factory health passes for linked current approved sample and active skill", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "skill-factory-health-ok-"));
  const designBrief = partyBrief();
  const hash = hashDesignBrief(designBrief);
  await writeStores(appDir, {
    ideas: [{
      id: "idea_party",
      designBrief,
    }],
    samples: [{
      id: "sample_party",
      ideaId: "idea_party",
      approved: true,
      designBriefHash: hash,
    }],
    skills: [{
      id: "skill_party",
      slash: "/party_officer_map",
      status: "active",
      sourceIdeaId: "idea_party",
      sourceSampleId: "sample_party",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/Party and Officer Map.md",
      validation: { status: "passed" },
    }],
  });

  const health = await createSkillFactoryHealthService({ appDir }).checkHealth();

  assert.equal(health.schema_version, "skill-factory-health/v1");
  assert.equal(health.state, "ok");
  assert.deepEqual(health.summary, {
    ideas: 1,
    samples: 1,
    configurableSkills: 1,
    activeSkills: 1,
    errors: 0,
    warnings: 0,
  });
  assert.equal(health.checks.every((check) => check.state === "ok"), true);
});

test("skill factory health accepts one active version in a valid skill family", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "skill-factory-health-version-ok-"));
  const designBrief = partyBrief();
  const hash = hashDesignBrief(designBrief);
  await writeStores(appDir, {
    ideas: [
      { id: "idea_party_v1", designBrief },
      { id: "idea_party_v2", designBrief },
    ],
    samples: [
      { id: "sample_party_v1", ideaId: "idea_party_v1", approved: true, designBriefHash: hash },
      { id: "sample_party_v2", ideaId: "idea_party_v2", approved: true, designBriefHash: hash },
    ],
    skills: [{
      id: "skill_party_v1",
      slash: "/party_officer_map",
      status: "disabled",
      version: 1,
      familyId: "skill_party_v1",
      replacedBySkillId: "skill_party_v2",
      sourceIdeaId: "idea_party_v1",
      sourceSampleId: "sample_party_v1",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/Party and Officer Map.md",
      validation: { status: "passed" },
    }, {
      id: "skill_party_v2",
      slash: "/party_officer_map",
      status: "active",
      version: 2,
      familyId: "skill_party_v1",
      previousSkillId: "skill_party_v1",
      sourceIdeaId: "idea_party_v2",
      sourceSampleId: "sample_party_v2",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/Party and Officer Map.md",
      validation: { status: "passed" },
    }],
  });

  const health = await createSkillFactoryHealthService({ appDir }).checkHealth();

  assert.equal(health.state, "ok");
  assert.ok(health.checks.some((check) => check.id === "skill_versions" && check.state === "ok"));
});

test("skill factory health accepts lifecycle statuses used by custom skill controls", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "skill-factory-health-lifecycle-statuses-"));
  const designBrief = partyBrief();
  const hash = hashDesignBrief(designBrief);
  await writeStores(appDir, {
    ideas: [
      { id: "idea_paused", designBrief },
      { id: "idea_archived", designBrief },
      { id: "idea_deleted", designBrief },
    ],
    samples: [
      { id: "sample_paused", ideaId: "idea_paused", approved: true, designBriefHash: hash },
      { id: "sample_archived", ideaId: "idea_archived", approved: true, designBriefHash: hash },
      { id: "sample_deleted", ideaId: "idea_deleted", approved: true, designBriefHash: hash },
    ],
    skills: [{
      id: "skill_paused",
      slash: "/paused_skill",
      status: "suspended",
      sourceIdeaId: "idea_paused",
      sourceSampleId: "sample_paused",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/Paused Skill.md",
      validation: { status: "passed" },
    }, {
      id: "skill_archived",
      slash: "/archived_skill",
      status: "archived",
      sourceIdeaId: "idea_archived",
      sourceSampleId: "sample_archived",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/Archived Skill.md",
      validation: { status: "passed" },
    }, {
      id: "skill_deleted",
      slash: "/deleted_skill",
      status: "deleted",
      sourceIdeaId: "idea_deleted",
      sourceSampleId: "sample_deleted",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/Deleted Skill.md",
      validation: { status: "passed" },
    }],
  });

  const health = await createSkillFactoryHealthService({ appDir }).checkHealth();
  const invalidStatusIssues = health.issues.filter((issue) => issue.code === "skill_invalid_status");

  assert.equal(health.state, "ok");
  assert.deepEqual(invalidStatusIssues, []);
  assert.equal(health.summary.activeSkills, 0);
});

test("skill factory health ignores deleted custom skill tombstone links", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "skill-factory-health-deleted-tombstone-"));
  await writeStores(appDir, {
    ideas: [],
    samples: [],
    skills: [{
      id: "skill_deleted",
      slash: "/deleted_skill",
      status: "deleted",
      previousSkillId: "missing_previous",
      replacedBySkillId: "missing_replacement",
      sourceIdeaId: "missing_idea",
      sourceSampleId: "missing_sample",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/Deleted Skill.md",
      validation: { status: "passed" },
    }],
  });

  const health = await createSkillFactoryHealthService({ appDir }).checkHealth();

  assert.equal(health.state, "ok");
  assert.deepEqual(health.issues, []);
  assert.equal(health.summary.configurableSkills, 1);
  assert.equal(health.summary.activeSkills, 0);
});

test("skill factory health reports stale approved samples, missing links, duplicate slashes, and bad output lanes", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "skill-factory-health-bad-"));
  await writeStores(appDir, {
    ideas: [{
      id: "idea_party",
      designBrief: partyBrief(),
    }],
    samples: [{
      id: "sample_party",
      ideaId: "idea_party",
      approved: true,
      designBriefHash: "stale-hash",
    }, {
      id: "sample_orphan",
      ideaId: "missing_idea",
      approved: false,
      designBriefHash: "",
    }],
    skills: [{
      id: "skill_party",
      slash: "/party_officer_map",
      status: "active",
      sourceIdeaId: "idea_party",
      sourceSampleId: "sample_party",
      targetLane: "20_Workshop",
      outputArtifact: "../Party and Officer Map.md",
      validation: { status: "passed" },
    }, {
      id: "skill_party_duplicate",
      slash: "/party_officer_map",
      status: "active",
      sourceIdeaId: "missing_idea",
      sourceSampleId: "missing_sample",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/Other.md",
      validation: { status: "pending" },
    }],
  });

  const health = await createSkillFactoryHealthService({ appDir }).checkHealth();
  const codes = health.issues.map((issue) => issue.code);

  assert.equal(health.state, "error");
  assert.ok(codes.includes("approved_sample_stale"));
  assert.ok(codes.includes("sample_missing_idea"));
  assert.ok(codes.includes("duplicate_active_slash"));
  assert.ok(codes.includes("skill_missing_idea"));
  assert.ok(codes.includes("skill_missing_sample"));
  assert.ok(codes.includes("skill_invalid_output"));
  assert.equal(health.summary.errors > 0, true);
});

test("skill factory health reports broken version links and duplicate active versions", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "skill-factory-health-version-bad-"));
  const designBrief = partyBrief();
  const hash = hashDesignBrief(designBrief);
  await writeStores(appDir, {
    ideas: [
      { id: "idea_party_v1", designBrief },
      { id: "idea_party_v2", designBrief },
    ],
    samples: [
      { id: "sample_party_v1", ideaId: "idea_party_v1", approved: true, designBriefHash: hash },
      { id: "sample_party_v2", ideaId: "idea_party_v2", approved: true, designBriefHash: hash },
    ],
    skills: [{
      id: "skill_party_v1",
      slash: "/party_officer_map_v1",
      status: "active",
      version: 1,
      familyId: "skill_party_family",
      replacedBySkillId: "missing_replacement",
      sourceIdeaId: "idea_party_v1",
      sourceSampleId: "sample_party_v1",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/Party and Officer Map.md",
      validation: { status: "passed" },
    }, {
      id: "skill_party_v2",
      slash: "/party_officer_map_v2",
      status: "active",
      version: 2,
      familyId: "skill_party_family",
      previousSkillId: "missing_previous",
      sourceIdeaId: "idea_party_v2",
      sourceSampleId: "sample_party_v2",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/Party and Officer Map.md",
      validation: { status: "passed" },
    }],
  });

  const health = await createSkillFactoryHealthService({ appDir }).checkHealth();
  const codes = health.issues.map((issue) => issue.code);

  assert.equal(health.state, "error");
  assert.ok(codes.includes("skill_missing_previous_version"));
  assert.ok(codes.includes("skill_missing_replacement_version"));
  assert.ok(codes.includes("duplicate_active_skill_family"));
  assert.ok(health.checks.some((check) => check.id === "skill_versions" && check.state === "error"));
});

test("skill factory health ignores stale sample state for failed draft history", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "skill-factory-health-failed-draft-"));
  const designBrief = partyBrief();
  const hash = hashDesignBrief(designBrief);
  await writeStores(appDir, {
    ideas: [{
      id: "idea_party",
      designBrief,
    }],
    samples: [{
      id: "sample_failed",
      ideaId: "idea_party",
      approved: false,
      designBriefHash: "old-hash",
    }, {
      id: "sample_active",
      ideaId: "idea_party",
      approved: true,
      designBriefHash: hash,
    }],
    skills: [{
      id: "skill_failed",
      slash: "/party_officer_map_failed_validation",
      status: "draft",
      sourceIdeaId: "idea_party",
      sourceSampleId: "sample_failed",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/Party and Officer Map.md",
      validation: { status: "failed", messages: ["Validation run output must include raw FILE citations."] },
    }, {
      id: "skill_active",
      slash: "/party_officer_map",
      status: "active",
      sourceIdeaId: "idea_party",
      sourceSampleId: "sample_active",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/Party and Officer Map.md",
      validation: { status: "passed" },
    }],
  });

  const health = await createSkillFactoryHealthService({ appDir }).checkHealth();

  assert.equal(health.state, "ok");
  assert.deepEqual(health.issues, []);
});

test("skill factory health reports malformed stores without throwing", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "skill-factory-health-malformed-"));
  await writeFile(path.join(appDir, "skill-ideas.json"), "{not-json", "utf8");
  await writeFile(path.join(appDir, "skill-samples.json"), JSON.stringify({
    schema_version: "skill-samples/v1",
    samples: [],
  }), "utf8");
  await writeFile(path.join(appDir, "configurable-skills.json"), JSON.stringify({
    schema_version: "configurable-skills/v1",
    skills: [],
  }), "utf8");

  const health = await createSkillFactoryHealthService({ appDir }).checkHealth();

  assert.equal(health.state, "error");
  assert.ok(health.issues.some((issue) => issue.code === "ideas_read"));
});

function partyBrief() {
  return {
    intendedUser: "Litigation team",
    problem: "Map formal parties and officers.",
    expectedInputs: "Matter context and source labels.",
    expectedOutputArtifact: "20_Workshop/Party and Officer Map.md",
    targetLane: "20_Workshop",
    paidPosture: "paid",
    riskLevel: "medium",
    notes: "Every factual assertion cites sources.",
  };
}

async function writeStores(appDir, { ideas = [], samples = [], skills = [] } = {}) {
  await writeFile(path.join(appDir, "skill-ideas.json"), `${JSON.stringify({
    schema_version: "skill-ideas/v1",
    ideas,
  }, null, 2)}\n`);
  await writeFile(path.join(appDir, "skill-samples.json"), `${JSON.stringify({
    schema_version: "skill-samples/v1",
    samples,
  }, null, 2)}\n`);
  await writeFile(path.join(appDir, "configurable-skills.json"), `${JSON.stringify({
    schema_version: "configurable-skills/v1",
    skills,
  }, null, 2)}\n`);
}
