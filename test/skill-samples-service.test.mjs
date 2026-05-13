import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSkillSamplesService } from "../services/skill-samples-service.mjs";

test("skill samples persist generated samples and approve only current design briefs", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "skill-samples-test-"));
  const service = createSkillSamplesService({
    appDir,
    now: () => new Date("2026-05-13T08:00:00.000Z"),
    idFactory: () => "sample_one",
  });
  const idea = {
    id: "idea_party_map",
    designBrief: {
      intendedUser: "Litigation team",
      problem: "Map parties and officers.",
      expectedInputs: "Matter context.",
      expectedOutputArtifact: "20_Workshop/Party and Officer Map.md",
      targetLane: "20_Workshop",
      paidPosture: "paid",
      riskLevel: "medium",
      notes: "Use source-backed citations.",
    },
  };

  const recorded = await service.recordSample({
    idea,
    sample: {
      generated_at: "2026-05-13T07:59:00.000Z",
      matter: {
        matter_name: "Ayesha Vs Japan Airlines",
        folder_name: "Ayesha Vs Japan Airlines",
      },
      sample_markdown: "# Party and Officer Map\n\n| Name | Evidence |\n| --- | --- |\n| Ayesha | FILE-0001 p1.b1 |",
      ai_run: {
        provider: "openai-direct",
        model: "gpt-5.4",
        task: "skill_sample_output",
      },
    },
  });

  assert.equal(recorded.sample.id, "sample_one");
  assert.equal(recorded.sample.ideaId, "idea_party_map");
  assert.equal(recorded.sample.approved, false);

  const approved = await service.approveSample({
    ideaId: idea.id,
    sampleId: "sample_one",
    designBrief: idea.designBrief,
  });
  assert.equal(approved.sample.approved, true);
  assert.equal(approved.sample.approvedAt, "2026-05-13T08:00:00.000Z");

  const current = await service.getApprovedCurrentSample({
    ideaId: idea.id,
    designBrief: idea.designBrief,
  });
  assert.equal(current.id, "sample_one");

  await assert.rejects(
    () => service.getApprovedCurrentSample({
      ideaId: idea.id,
      designBrief: {
        ...idea.designBrief,
        notes: "Changed after approval.",
      },
    }),
    /Approved sample is stale/,
  );

  const rawStore = await readFile(path.join(appDir, "skill-samples.json"), "utf8");
  assert.doesNotMatch(rawStore, /OPENAI_API_KEY|\.env|full extraction record/i);
});

test("skill samples list versions with current, stale, and approval states", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "skill-samples-ledger-test-"));
  let id = 0;
  const service = createSkillSamplesService({
    appDir,
    now: () => new Date("2026-05-13T09:00:00.000Z"),
    idFactory: () => `sample_${++id}`,
  });
  const idea = {
    id: "idea_ledger",
    designBrief: {
      intendedUser: "Litigation team",
      problem: "Map parties and officers.",
      expectedInputs: "Matter context.",
      expectedOutputArtifact: "20_Workshop/Party and Officer Map.md",
      targetLane: "20_Workshop",
      paidPosture: "paid",
      riskLevel: "medium",
      notes: "Use source-backed citations.",
    },
  };

  await service.recordSample({
    idea,
    sample: {
      matter: { matter_name: "Matter A", folder_name: "Matter A" },
      sample_markdown: "# Sample one",
      feedback: "",
      ai_run: { provider: "openai-direct", model: "gpt-5.4" },
    },
  });
  await service.recordSample({
    idea,
    sample: {
      matter: { matter_name: "Matter A", folder_name: "Matter A" },
      sample_markdown: "# Sample two",
      feedback: "Make it more source-backed.",
      ai_run: { provider: "openai-direct", model: "gpt-5.4" },
    },
  });

  await service.approveSample({
    ideaId: idea.id,
    sampleId: "sample_1",
    designBrief: idea.designBrief,
  });
  await service.approveSample({
    ideaId: idea.id,
    sampleId: "sample_2",
    designBrief: idea.designBrief,
  });

  const currentLedger = await service.listSamplesForIdea({
    ideaId: idea.id,
    designBrief: idea.designBrief,
  });
  assert.deepEqual(currentLedger.samples.map((sample) => [sample.id, sample.approved, sample.state]), [
    ["sample_1", false, "current"],
    ["sample_2", true, "approved_current"],
  ]);
  assert.equal(currentLedger.samples[1].feedback, "Make it more source-backed.");

  const staleLedger = await service.listSamplesForIdea({
    ideaId: idea.id,
    designBrief: {
      ...idea.designBrief,
      notes: "Changed after approval.",
    },
  });
  assert.deepEqual(staleLedger.samples.map((sample) => [sample.id, sample.approved, sample.state]), [
    ["sample_1", false, "stale"],
    ["sample_2", true, "approved_stale"],
  ]);
});
