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
