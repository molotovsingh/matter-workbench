import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeDbSkillSamplesService } from "../services/runtime-db-skill-samples-service.mjs";
import { hashDesignBrief } from "../services/skill-samples-service.mjs";

const tenantId = "82dc5ad0-fb23-5c08-a06c-73232cd0281f";

test("runtime DB skill samples service reads approved samples with payload markdown", async () => {
  const designBrief = readyDesignBrief();
  const calls = [];
  const service = createRuntimeDbSkillSamplesService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn(calls, {
      id: "sample_story",
      ideaId: "idea_story",
      version: 1,
      approved: true,
      approvedAt: "2026-06-06T01:00:00.000Z",
      designBriefHash: hashDesignBrief(designBrief),
      matterName: "DB Matter",
      matterFolderName: "DB Matter",
      sampleMarkdown: "# The Story\n\nA source-backed story.",
      feedback: "",
      aiRun: { provider: "openai-direct", model: "gpt-5.4" },
      warnings: [],
      rawSample: { sample_markdown: "# The Story\n\nA source-backed story." },
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T01:00:00.000Z",
    }),
  });

  const sample = await service.getApprovedCurrentSample({ ideaId: "idea_story", designBrief });

  assert.equal(sample.id, "sample_story");
  assert.equal(sample.approved, true);
  assert.equal(sample.sampleMarkdown, "# The Story\n\nA source-backed story.");
  assert.equal(sample.aiRun.provider, "openai-direct");
  assertSafeRuntimeRoleGuard(calls[0].input);
  assert.match(calls[0].input, /storage_object_payloads/i);
  assert.doesNotMatch(calls[0].input, /secret/);
});

test("runtime DB skill samples service records and approves samples in Postgres", async () => {
  const designBrief = readyDesignBrief();
  const calls = [];
  const service = createRuntimeDbSkillSamplesService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      dbSampleRow({ id: "sample_route_plan", ideaId: "idea_route_plan", designBriefHash: hashDesignBrief(designBrief), approved: false }),
      dbSampleRow({ id: "sample_route_plan", ideaId: "idea_route_plan", designBriefHash: hashDesignBrief(designBrief), approved: true }),
    ]),
    now: () => new Date("2026-06-06T02:00:00.000Z"),
    idFactory: () => "sample_route_plan",
  });

  const recorded = await service.recordSample({
    idea: { id: "idea_route_plan", designBrief },
    sample: {
      matter: { matter_name: "DB Matter", folder_name: "DB Matter" },
      sample_markdown: "# Filing Route Plan\n\nUse consumer forum.",
      feedback: "Looks useful.",
      ai_run: { provider: "openai-direct", model: "gpt-5.4" },
      warnings: ["check limitation"],
    },
  });
  const approved = await service.approveSample({
    ideaId: "idea_route_plan",
    sampleId: "sample_route_plan",
    designBrief,
  });

  assert.equal(recorded.sample.id, "sample_route_plan");
  assert.equal(recorded.sample.version, 1);
  assert.equal(approved.sample.approved, true);
  const sql = calls.map((call) => call.input || "").join("\n");
  assertTransactionWrapped(calls[0].input);
  assertTransactionWrapped(calls[1].input);
  assert.match(sql, /insert into storage_objects/i);
  assert.match(sql, /insert into storage_object_payloads/i);
  assert.match(sql, /insert into skill_samples/i);
  assert.match(sql, /object_role, state, mime_type/);
  assert.match(sql, /local-skill-samples\/sample_route_plan\.md/);
  assert.match(sql, /update skill_samples[\s\S]*approved = false/i);
  assert.doesNotMatch(sql, /secret/);
});

test("runtime DB skill samples service fails closed when sample writes return no row", async () => {
  const calls = [];
  const designBrief = readyDesignBrief();
  const service = createRuntimeDbSkillSamplesService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn(calls, {}),
    idFactory: () => "sample_missing_return",
  });

  await assert.rejects(
    () => service.recordSample({
      idea: { id: "idea_route_plan", designBrief },
      sample: { sample_markdown: "# Filing Route Plan" },
    }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "runtime_db.skill_sample.write_failed");
      return true;
    },
  );

  assertTransactionWrapped(calls[0].input);
});

test("runtime DB skill samples service distinguishes stale approval from missing samples", async () => {
  const calls = [];
  const designBrief = readyDesignBrief();
  const service = createRuntimeDbSkillSamplesService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      { errorCode: "runtime_db.skill_sample.stale" },
      { errorCode: "runtime_db.skill_sample.not_found" },
    ]),
  });

  await assert.rejects(
    () => service.approveSample({ ideaId: "idea_route_plan", sampleId: "sample_route_plan", designBrief }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "runtime_db.skill_sample.stale");
      return true;
    },
  );
  await assert.rejects(
    () => service.approveSample({ ideaId: "idea_route_plan", sampleId: "missing_sample", designBrief }),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, "runtime_db.skill_sample.not_found");
      return true;
    },
  );

  assertTransactionWrapped(calls[0].input);
  assertTransactionWrapped(calls[1].input);
  assert.match(calls[0].input, /runtime_db\.skill_sample\.stale/);
  assert.match(calls[0].input, /runtime_db\.skill_sample\.not_found/);
});

function dbSampleRow({
  id = "sample_route_plan",
  ideaId = "idea_route_plan",
  designBriefHash = hashDesignBrief(readyDesignBrief()),
  approved = false,
} = {}) {
  return {
    id,
    ideaId,
    version: 1,
    approved,
    approvedAt: approved ? "2026-06-06T02:00:00.000Z" : "",
    designBriefHash,
    matterName: "DB Matter",
    matterFolderName: "DB Matter",
    sampleMarkdown: "# Filing Route Plan\n\nUse consumer forum.",
    feedback: "Looks useful.",
    aiRun: { provider: "openai-direct", model: "gpt-5.4" },
    warnings: ["check limitation"],
    rawSample: { sample_markdown: "# Filing Route Plan\n\nUse consumer forum." },
    createdAt: "2026-06-06T02:00:00.000Z",
    updatedAt: "2026-06-06T02:00:00.000Z",
  };
}

function readyDesignBrief() {
  return {
    intendedUser: "advocate",
    problem: "Recommend the right law, forum, and documents to prepare.",
    expectedInputs: "matter record and source-backed chronology",
    expectedOutputArtifact: "20_Workshop/Filing Route Plan.md",
    targetLane: "20_Workshop",
    paidPosture: "paid",
    riskLevel: "medium",
    notes: "Include practical next steps and source discipline.",
  };
}

function jsonSpawn(calls, payload) {
  return (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    return {
      status: 0,
      stdout: `${JSON.stringify(payload)}\n`,
      stderr: "",
    };
  };
}

function jsonSpawnSequence(calls, payloads) {
  let index = 0;
  return (command, args, options = {}) => {
    calls.push({ command, args, input: options.input });
    const payload = payloads[Math.min(index, payloads.length - 1)];
    index += 1;
    return {
      status: 0,
      stdout: `${JSON.stringify(payload)}\n`,
      stderr: "",
    };
  };
}

function assertSafeRuntimeRoleGuard(sql) {
  assert.match(sql, /pg_roles/i);
  assert.match(sql, /rolsuper/i);
  assert.match(sql, /rolbypassrls/i);
  assert.match(sql, /current_user/i);
}

function assertTransactionWrapped(sql) {
  assert.match(sql, /^\s*begin;/i);
  assert.match(sql, /\bcommit;\s*$/i);
  assertSafeRuntimeRoleGuard(sql);
}
