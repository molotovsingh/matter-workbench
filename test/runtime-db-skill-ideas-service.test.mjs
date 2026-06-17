import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeDbSkillIdeasService } from "../services/runtime-db-skill-ideas-service.mjs";

const tenantId = "82dc5ad0-fb23-5c08-a06c-73232cd0281f";

test("runtime DB skill ideas service lists and normalizes DB ideas", async () => {
  const calls = [];
  const service = createRuntimeDbSkillIdeasService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn(calls, [{
      id: "idea_story",
      text: "Create a dispute story skill.",
      status: "ready_for_review",
      matterName: "Ayesha Vs Japan Airlines",
      matterFolderName: "Ayesha Vs Japan Airlines",
      designBriefJson: readyDesignBrief(),
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T01:00:00.000Z",
    }]),
  });

  const result = await service.listIdeas();

  assert.equal(result.schema_version, "skill-ideas/v1");
  assert.equal(result.ideas.length, 1);
  assert.equal(result.ideas[0].id, "idea_story");
  assert.equal(result.ideas[0].status, "ready_for_review");
  assert.equal(result.ideas[0].matter.folderName, "Ayesha Vs Japan Airlines");
  assert.equal(result.ideas[0].readiness.ready, true);
  assertSafeRuntimeRoleGuard(calls[0].input);
  assert.match(calls[0].input, /from skill_ideas/i);
  assert.doesNotMatch(calls[0].input, /secret/);
});

test("runtime DB skill ideas service creates and updates ideas in Postgres", async () => {
  const calls = [];
  const service = createRuntimeDbSkillIdeasService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      dbIdeaRow({ id: "idea_route_plan", status: "incomplete" }),
      dbIdeaRow({ id: "idea_route_plan", status: "ready_for_review", designBriefJson: { ...readyDesignBrief(), notes: "Prefer concise issue-wise output." } }),
      dbIdeaRow({ id: "idea_route_plan", status: "parked" }),
      dbIdeaRow({ id: "idea_route_plan", status: "created" }),
    ]),
    now: () => new Date("2026-06-06T02:00:00.000Z"),
    idFactory: () => "idea_route_plan",
  });

  const created = await service.createIdea({
    text: "Recommend the law, forum, and filing documents.",
    matter: { matterName: "DB Matter", folderName: "DB Matter" },
    designBrief: readyDesignBrief(),
  });
  const updated = await service.updateIdeaDesignBrief("idea_route_plan", {
    ...readyDesignBrief(),
    notes: "Prefer concise issue-wise output.",
  });
  const parked = await service.updateIdeaStatus("idea_route_plan", "parked");
  const createdStatus = await service.updateIdeaStatus("idea_route_plan", "created");

  assert.equal(created.idea.id, "idea_route_plan");
  assert.equal(created.idea.status, "incomplete");
  assert.equal(updated.idea.designBrief.notes, "Prefer concise issue-wise output.");
  assert.equal(parked.idea.status, "parked");
  assert.equal(createdStatus.idea.status, "created");
  const sql = calls.map((call) => call.input || "").join("\n");
  assertTransactionWrapped(calls[0].input);
  assertTransactionWrapped(calls[1].input);
  assertTransactionWrapped(calls[2].input);
  assertTransactionWrapped(calls[3].input);
  assert.match(sql, /insert into skill_ideas/i);
  assert.match(sql, /update skill_ideas/i);
  assert.match(sql, /matter_folder_name/i);
  assert.match(sql, /"expectedOutputArtifact":"20_Workshop\/Filing Route Plan.md"/);
  assert.doesNotMatch(sql, /secret/);
});

test("runtime DB skill ideas service fails closed when updates return no row", async () => {
  const calls = [];
  const service = createRuntimeDbSkillIdeasService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn(calls, {}),
  });

  await assert.rejects(
    () => service.updateIdeaDesignBrief("missing_idea", readyDesignBrief()),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, "runtime_db.skill_idea.not_found");
      return true;
    },
  );

  assertTransactionWrapped(calls[0].input);
});

test("runtime DB skill ideas service fails closed when creates return no row", async () => {
  const calls = [];
  const service = createRuntimeDbSkillIdeasService({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn(calls, {}),
    idFactory: () => "idea_missing_return",
  });

  await assert.rejects(
    () => service.createIdea({ text: "Draft a filing route plan.", designBrief: readyDesignBrief() }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "runtime_db.skill_idea.write_failed");
      return true;
    },
  );

  assertTransactionWrapped(calls[0].input);
});

function dbIdeaRow({
  id = "idea_route_plan",
  text = "Recommend the law, forum, and filing documents.",
  status = "incomplete",
  designBriefJson = readyDesignBrief(),
  matterName = "DB Matter",
  matterFolderName = "DB Matter",
} = {}) {
  return {
    id,
    text,
    status,
    matterName,
    matterFolderName,
    designBriefJson,
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
