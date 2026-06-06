import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRuntimeDbConfigurableSkillRunsService } from "../services/runtime-db-configurable-skill-runs-service.mjs";

test("runtime DB configurable skill run ledger writes and lists canonical receipts", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "runtime-db-skill-runs-"));
  const matterRoot = path.join(tmp, "Runtime DB Matter");
  await mkdir(path.join(matterRoot, "20_Workshop"), { recursive: true });
  await writeFile(path.join(matterRoot, "20_Workshop", "The Story.md"), "# The Story\n");

  const calls = [];
  const service = createRuntimeDbConfigurableSkillRunsService({
    databaseUrl: "postgres://mwb:secret@127.0.0.1:5432/matter_workbench_shadow",
    tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    spawn: fakeSpawn(calls),
    now: () => new Date("2026-06-06T10:00:00.000Z"),
    idFactory: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });

  const running = await service.createRun({
    skillId: "skill_story",
    skillVersion: 1,
    slash: "/the_story",
    title: "The Story v1",
    matterId: "11111111-1111-4111-8111-111111111111",
    matterName: "Runtime DB Matter",
    matterFolder: "Runtime DB Matter",
    matterRoot,
    outputPaths: {
      markdown: "20_Workshop/The Story.md",
      json: "20_Workshop/The Story.json",
    },
    aiRun: {
      provider: "openai-direct",
      model: "gpt-5.4",
      task: "configurable_skill_run",
      policyPromptVersion: "legal-workbench-policy/v1",
    },
  });
  assert.equal(running.id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.equal(running.status, "running");

  const succeeded = await service.updateRun(running.id, {
    status: "succeeded",
    matterRoot,
    outputPaths: running.outputPaths,
    warnings: ["bounded context omitted 3 blocks"],
  });
  assert.equal(succeeded.receipt.receiptState, "completed");
  assert.equal(succeeded.receipt.canOpenOutput, true);
  assert.equal(succeeded.outputAvailability.markdown, "present");

  const listed = await service.listRuns({ slash: "/the_story" });
  assert.equal(listed.schema_version, "configurable-skill-runs/v1");
  assert.equal(listed.runs.length, 1);
  assert.equal(listed.runs[0].id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.equal(listed.runs[0].matterRoot, "postgres:Runtime DB Matter");
  assert.equal(listed.runs[0].receipt.receiptState, "completed");

  assert.ok(calls.some((sql) => /insert into configurable_skill_runs/i.test(sql)));
  assert.ok(calls.some((sql) => /update configurable_skill_runs/i.test(sql)));
  assert.ok(calls.some((sql) => /from configurable_skill_runs csr/i.test(sql)));
  assertTransactionWrapped(calls.find((sql) => /insert into configurable_skill_runs/i.test(sql)));
  assertTransactionWrapped(calls.find((sql) => /update configurable_skill_runs/i.test(sql)));
  assertSafeRuntimeRoleGuard(calls.find((sql) => /from configurable_skill_runs csr/i.test(sql)));
});

test("runtime DB configurable skill run ledger rechecks DB object availability on list", async () => {
  const calls = [];
  const service = createRuntimeDbConfigurableSkillRunsService({
    databaseUrl: "postgres://mwb:secret@127.0.0.1:5432/matter_workbench_shadow",
    tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    spawn: fakeSpawn(calls, { listedMarkdownAvailability: "missing" }),
  });

  const listed = await service.listRuns({ slash: "/the_story" });

  assert.equal(listed.runs[0].outputAvailability.markdown, "missing");
  assert.equal(listed.runs[0].receipt.receiptState, "output_missing");
  assert.ok(calls.some((sql) => /from storage_objects so/i.test(sql)));
  assertSafeRuntimeRoleGuard(calls.find((sql) => /from storage_objects so/i.test(sql)));
});

function fakeSpawn(calls, { listedMarkdownAvailability = "present" } = {}) {
  return (_command, _args, options = {}) => {
    const sql = String(options.input || "");
    calls.push(sql);
    if (/from storage_objects so/i.test(sql)) {
      const availability = /The Story\.md/i.test(sql) ? listedMarkdownAvailability : "unknown";
      return spawnResult(JSON.stringify({ availability }));
    }
    if (/from configurable_skill_runs csr/i.test(sql)) {
      return spawnResult(JSON.stringify([
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          skillId: "skill_story",
          skillVersion: 1,
          slash: "/the_story",
          title: "The Story v1",
          matterId: "11111111-1111-4111-8111-111111111111",
          matterName: "Runtime DB Matter",
          matterFolder: "Runtime DB Matter",
          matterRoot: "postgres:Runtime DB Matter",
          status: "succeeded",
          startedAt: "2026-06-06T10:00:00.000Z",
          finishedAt: "2026-06-06T10:00:00.000Z",
          outputPaths: {
            markdown: "20_Workshop/The Story.md",
            json: "20_Workshop/The Story.json",
          },
          outputAvailability: {
            markdown: "present",
            json: "unknown",
          },
          overwrite: "not_needed",
          warnings: ["bounded context omitted 3 blocks"],
          aiRun: {
            provider: "openai-direct",
            model: "gpt-5.4",
            task: "configurable_skill_run",
            policyPromptVersion: "legal-workbench-policy/v1",
          },
        },
      ]));
    }
    return spawnResult("{}");
  };
}

function spawnResult(stdout) {
  return {
    status: 0,
    stdout,
    stderr: "",
  };
}

function assertSafeRuntimeRoleGuard(sql) {
  assert.match(sql || "", /pg_roles/i);
  assert.match(sql || "", /rolsuper/i);
  assert.match(sql || "", /rolbypassrls/i);
  assert.match(sql || "", /current_user/i);
}

function assertTransactionWrapped(sql) {
  assert.match(sql || "", /^\s*begin;/i);
  assert.match(sql || "", /\bcommit;\s*$/i);
  assertSafeRuntimeRoleGuard(sql);
}
