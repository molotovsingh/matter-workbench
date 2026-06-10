import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeDbConfigurableSkillStore } from "../services/runtime-db-configurable-skill-store.mjs";

const tenantId = "82dc5ad0-fb23-5c08-a06c-73232cd0281f";

test("runtime DB configurable skill store reads DB rows as local skill definitions", async () => {
  const calls = [];
  const store = createRuntimeDbConfigurableSkillStore({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn(calls, {
      catalogFingerprint: "catalog-v1",
      skills: [{
        id: "4928f28b-0d3b-49e5-93a0-72c94358c87b",
        title: "The Story",
        slash: "/the_story",
        status: "active",
        previousStatus: "",
        statusChangedAt: "2026-06-06T01:00:00.000Z",
        statusChangeReason: "",
        createdAt: "2026-06-06T00:00:00.000Z",
        updatedAt: "2026-06-06T01:00:00.000Z",
        versionNumber: 2,
        sourceIdeaId: "idea_story",
        policyPromptVersion: "legal-workbench-policy/v1",
        definitionJson: {
          local_id: "skill_story",
          family_id: "skill_story",
          description: "Tell the dispute story.",
          target_lane: "20_Workshop",
          output_artifact: "20_Workshop/The Story.md",
          matter_required: true,
          paid_provider_call: true,
          source_backed: "required",
          source_sample_id: "sample_story",
          approved_sample_hash: "abc123",
          prompt_config: { prompt: "Write the story.", citationPolicy: "Use sources." },
          model_policy: { task: "configurable_skill_run" },
          validation: { status: "passed", messages: [] },
        },
      }],
    }),
  });

  const result = await store.readStore();

  assert.equal(result.schema_version, "configurable-skills/v1");
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].id, "skill_story");
  assert.equal(result.skills[0].title, "The Story");
  assert.equal(result.skills[0].version, 2);
  assert.equal(result.skills[0].sourceIdeaId, "idea_story");
  assert.equal(result.skills[0].sourceSampleId, "sample_story");
  assertSafeRuntimeRoleGuard(calls[0].input);
  assert.match(calls[0].input, /catalogFingerprint/i);
  assert.match(calls[0].input, /configurable_skill_versions/i);
  assert.doesNotMatch(calls[0].input, /secret/);
});

test("runtime DB configurable skill store writes mutated skills to skill and version tables", async () => {
  const calls = [];
  const store = createRuntimeDbConfigurableSkillStore({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      [],
      {},
    ]),
    now: () => new Date("2026-06-06T02:00:00.000Z"),
  });

  const result = await store.updateStore((draft) => {
    draft.skills.push({
      id: "skill_route_plan",
      title: "Filing Route Plan",
      slash: "/filing_route_plan",
      description: "Recommend law, forum, and filing documents.",
      status: "active",
      version: 1,
      sourceIdeaId: "idea_route_plan",
      sourceSampleId: "sample_route_plan",
      approvedSampleHash: "hash_route_plan",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/Filing Route Plan.md",
      matterRequired: true,
      paidProviderCall: true,
      sourceBacked: "required",
      promptConfig: { prompt: "Prepare the route plan.", citationPolicy: "Use matter sources." },
      modelPolicy: { task: "configurable_skill_run", policyPromptVersion: "legal-workbench-policy/v1" },
      validation: { status: "passed", messages: [] },
      createdAt: "2026-06-06T02:00:00.000Z",
      updatedAt: "2026-06-06T02:00:00.000Z",
    });
    return { created: true };
  });

  assert.deepEqual(result, { created: true });
  const sql = calls.map((call) => call.input || "").join("\n");
  assertTransactionWrapped(calls[1].input);
  assert.match(sql, /insert into configurable_skills/i);
  assert.match(sql, /insert into configurable_skill_versions/i);
  assert.match(sql, /update configurable_skills\s+set current_version_id/i);
  assert.match(sql, /"local_id":"skill_route_plan"/);
  assert.match(sql, /"source_sample_id":"sample_route_plan"/);
  assert.doesNotMatch(sql, /secret/);
});

test("runtime DB configurable skill store writes replacement store returned by mutator", async () => {
  const calls = [];
  const store = createRuntimeDbConfigurableSkillStore({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      [],
      {},
    ]),
  });

  await store.updateStore(() => ({
    schema_version: "configurable-skills/v1",
    skills: [{
      id: "skill_replacement",
      title: "Replacement Skill",
      slash: "/replacement_skill",
      description: "Persisted from returned store.",
      status: "active",
      version: 1,
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/Replacement Skill.md",
      matterRequired: true,
      paidProviderCall: false,
      sourceBacked: "required",
      promptConfig: { prompt: "Return replacement.", citationPolicy: "Use sources." },
      modelPolicy: { task: "configurable_skill_run", policyPromptVersion: "legal-workbench-policy/v1" },
      validation: { status: "passed", messages: [] },
      createdAt: "2026-06-06T02:00:00.000Z",
      updatedAt: "2026-06-06T02:00:00.000Z",
    }],
  }));

  const sql = calls.map((call) => call.input || "").join("\n");
  assert.match(sql, /"local_id":"skill_replacement"/);
  assert.match(sql, /'Replacement Skill'/);
});

test("runtime DB configurable skill updates guard against stale catalog overwrites", async () => {
  const calls = [];
  const store = createRuntimeDbConfigurableSkillStore({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence(calls, [
      [{
        id: "4928f28b-0d3b-49e5-93a0-72c94358c87b",
        title: "The Story",
        slash: "/the_story",
        status: "active",
        previousStatus: "",
        statusChangedAt: "",
        statusChangeReason: "",
        createdAt: "2026-06-06T00:00:00.000Z",
        updatedAt: "2026-06-06T01:00:00.000Z",
        versionNumber: 1,
        sourceIdeaId: "idea_story",
        policyPromptVersion: "legal-workbench-policy/v1",
        definitionJson: {
          local_id: "skill_story",
          family_id: "skill_story",
          description: "Tell the dispute story.",
          target_lane: "20_Workshop",
          output_artifact: "20_Workshop/The Story.md",
          matter_required: true,
          paid_provider_call: true,
          source_backed: "required",
          prompt_config: { prompt: "Write the story.", citationPolicy: "Use sources." },
          model_policy: { task: "configurable_skill_run" },
          validation: { status: "passed", messages: [] },
        },
      }],
      {},
    ]),
  });

  await store.updateStore((draft) => {
    draft.skills[0].title = "The Story Updated";
  });

  const writeSql = calls[1].input;
  assert.match(writeSql, /pg_advisory_xact_lock/i);
  assert.match(writeSql, /runtime DB configurable skill catalog changed during update/i);
});

test("runtime DB configurable skill stale catalog errors fail as conflicts", async () => {
  const store = createRuntimeDbConfigurableSkillStore({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawnSequence([], [
      [],
      {
        status: 1,
        stderr: "ERROR: runtime DB configurable skill catalog changed during update",
      },
    ]),
  });

  await assert.rejects(
    () => store.updateStore((draft) => {
      draft.skills.push({
        id: "skill_story",
        title: "The Story",
        slash: "/the_story",
        status: "active",
        version: 1,
      });
    }),
    (error) => error?.statusCode === 409 && /catalog changed/i.test(error.message),
  );
});

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
    if (payload && typeof payload.status === "number") {
      return {
        status: payload.status,
        stdout: payload.stdout || "",
        stderr: payload.stderr || "",
      };
    }
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
