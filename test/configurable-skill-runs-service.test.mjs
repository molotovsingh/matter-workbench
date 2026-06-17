import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CONFIGURABLE_SKILL_RUNS_SCHEMA_VERSION,
  createConfigurableSkillRunsService,
  normalizeRunRecord,
} from "../services/configurable-skill-runs-service.mjs";

test("configurable skill run ledger records running and succeeded metadata only", async () => {
  const service = await makeService();
  const running = await service.createRun({
    skillId: "skill_party",
    slash: "/party_officer_map",
    title: "Party and Officer Map",
    matterName: "Ayesha Vs Japan Airlines",
    matterFolder: "Ayesha Vs Japan Airlines",
    matterRoot: "/tmp/matters/Ayesha Vs Japan Airlines",
    outputPaths: {
      markdown: "20_Workshop/Party and Officer Map.md",
      json: "20_Workshop/Party and Officer Map.json",
    },
    aiRun: {
      provider: "openai-direct",
      model: "gpt-5.4",
      task: "configurable_skill_run",
      policyPromptVersion: "legal-workbench-policy/v1",
    },
    prompt: "must not persist",
    markdown: "# must not persist",
    contextPacket: { raw: "must not persist" },
  });
  assert.equal(running.status, "running");

  const succeeded = await service.updateRun(running.id, {
    status: "succeeded",
    warnings: ["bounded context omitted 5 blocks"],
  });

  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.outputPaths.markdown, "20_Workshop/Party and Officer Map.md");
  assert.equal(succeeded.aiRun.model, "gpt-5.4");
  assert.equal(succeeded.aiRun.policyPromptVersion, "legal-workbench-policy/v1");
  assert.equal(succeeded.warnings[0], "bounded context omitted 5 blocks");

  const rawStore = await readFile(service.storePath, "utf8");
  assert.doesNotMatch(rawStore, /must not persist|contextPacket|# must not persist|OPENAI_API_KEY|\.env/);
});

test("configurable skill run ledger records failed, cancelled, filters, and limits", async () => {
  const service = await makeService();
  const first = await service.createRun({
    skillId: "skill_party",
    slash: "/party_officer_map",
    matterFolder: "Ayesha Vs Japan Airlines",
    overwrite: "approved",
  });
  await service.updateRun(first.id, {
    status: "failed",
    errorMessage: "provider returned malformed output",
  });
  await service.recordCancelledRun({
    skillId: "skill_party",
    slash: "/party_officer_map",
    title: "Party and Officer Map",
    matterFolder: "Mehta vs Skyline",
    outputPaths: {
      markdown: "20_Workshop/Party and Officer Map.md",
      json: "20_Workshop/Party and Officer Map.json",
    },
  });
  await service.createRun({
    skillId: "skill_other",
    slash: "/other_skill",
    matterFolder: "Mehta vs Skyline",
  });

  const partyRuns = await service.listRuns({ slash: "/party_officer_map" });
  assert.equal(partyRuns.runs.length, 2);
  assert.equal(partyRuns.runs[0].status, "cancelled");
  assert.equal(partyRuns.runs[0].overwrite, "cancelled");
  assert.equal(partyRuns.runs[1].status, "failed");
  assert.equal(partyRuns.runs[1].overwrite, "approved");

  const mehtaRuns = await service.listRuns({ matterFolder: "Mehta vs Skyline", limit: 1 });
  assert.equal(mehtaRuns.runs.length, 1);
  assert.equal(mehtaRuns.runs[0].matterFolder, "Mehta vs Skyline");
});

test("configurable skill run ledger missing store returns empty list", async () => {
  const service = await makeService();
  const listed = await service.listRuns();
  assert.deepEqual(listed, {
    schema_version: "configurable-skill-runs/v1",
    runs: [],
  });
});

test("configurable skill run ledger reports whether output files still exist", async () => {
  const service = await makeService();
  const matterRoot = await mkdtemp(path.join(os.tmpdir(), "skill-runs-matter-"));
  const run = await service.createRun({
    skillId: "skill_party",
    slash: "/party_officer_map",
    title: "Party and Officer Map",
    matterName: "Ayesha Vs Japan Airlines",
    matterFolder: "Ayesha Vs Japan Airlines",
    matterRoot,
    outputPaths: {
      markdown: "20_Workshop/Party and Officer Map.md",
      json: "20_Workshop/Party and Officer Map.json",
    },
  });
  await service.updateRun(run.id, { status: "succeeded" });

  let listed = await service.listRuns();
  assert.deepEqual(listed.runs[0].outputAvailability, {
    markdown: "missing",
    json: "missing",
  });
  assert.equal(listed.runs[0].receipt.receiptState, "output_missing");
  assert.equal(listed.runs[0].receipt.needsAttention, true);

  await mkdir(path.join(matterRoot, "20_Workshop"), { recursive: true });
  await writeFile(path.join(matterRoot, "20_Workshop", "Party and Officer Map.md"), "# Party Map\n");
  await writeFile(path.join(matterRoot, "20_Workshop", "Party and Officer Map.json"), "{}\n");

  listed = await service.listRuns();
  assert.deepEqual(listed.runs[0].outputAvailability, {
    markdown: "present",
    json: "present",
  });
  assert.equal(listed.runs[0].receipt.receiptState, "completed");
  assert.equal(listed.runs[0].receipt.isCompletedWork, true);
});

test("configurable skill run ledger treats unsafe output paths as missing", async () => {
  const service = await makeService();
  const matterRoot = await mkdtemp(path.join(os.tmpdir(), "skill-runs-matter-"));
  const run = await service.createRun({
    skillId: "skill_party",
    slash: "/party_officer_map",
    title: "Party and Officer Map",
    matterName: "Ayesha Vs Japan Airlines",
    matterFolder: "Ayesha Vs Japan Airlines",
    matterRoot,
    outputPaths: {
      markdown: "../outside.md",
    },
  });
  await service.updateRun(run.id, { status: "succeeded" });

  const listed = await service.listRuns();
  assert.equal(listed.runs[0].outputAvailability.markdown, "missing");
  assert.equal(listed.runs[0].receipt.receiptState, "output_missing");
  assert.equal(listed.runs[0].receipt.canOpenOutput, false);
});

test("configurable skill run normalization bounds fields", () => {
  const record = normalizeRunRecord({
    id: "run_1",
    status: "unknown",
    overwrite: "unknown",
    warnings: Array.from({ length: 20 }, (_, index) => `warning ${index}`),
    errorMessage: "x".repeat(1000),
  });
  assert.equal(record.status, "running");
  assert.equal(record.overwrite, "not_needed");
  assert.equal(record.warnings.length, 10);
  assert.ok(record.errorMessage.length <= 800);
});

test("configurable skill run ledger emits stable validation and missing-run codes", async () => {
  const service = await makeService();
  await assertRejectsCode(() => service.updateRun(" ", {}), "configurable_skill_run.id_required", 400);
  await assertRejectsCode(() => service.updateRun("missing", {}), "configurable_skill_run.not_found", 404);
});

test("configurable skill run ledger emits stable local-store diagnostic codes", async () => {
  const invalidJsonDir = await mkdtemp(path.join(os.tmpdir(), "skill-runs-invalid-json-"));
  await writeFile(path.join(invalidJsonDir, "configurable-skill-runs.json"), "{not json\n");
  await assertRejectsCode(
    () => createConfigurableSkillRunsService({ appDir: invalidJsonDir }).listRuns(),
    "configurable_skill_runs.invalid_json",
    500,
  );

  const invalidSchemaDir = await mkdtemp(path.join(os.tmpdir(), "skill-runs-invalid-schema-"));
  await writeFile(path.join(invalidSchemaDir, "configurable-skill-runs.json"), `${JSON.stringify({ schema_version: "old", runs: [] })}\n`);
  await assertRejectsCode(
    () => createConfigurableSkillRunsService({ appDir: invalidSchemaDir }).listRuns(),
    "configurable_skill_runs.invalid_schema",
    500,
  );

  const invalidStoreDir = await mkdtemp(path.join(os.tmpdir(), "skill-runs-invalid-store-"));
  await writeFile(path.join(invalidStoreDir, "configurable-skill-runs.json"), `${JSON.stringify({ schema_version: CONFIGURABLE_SKILL_RUNS_SCHEMA_VERSION, runs: {} })}\n`);
  await assertRejectsCode(
    () => createConfigurableSkillRunsService({ appDir: invalidStoreDir }).listRuns(),
    "configurable_skill_runs.invalid_store",
    500,
  );
});

async function assertRejectsCode(operation, code, statusCode) {
  let thrown;
  try {
    await operation();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, `expected ${code} to be thrown`);
  assert.equal(thrown.code, code);
  assert.equal(thrown.statusCode, statusCode);
}

async function makeService() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "skill-runs-test-"));
  let counter = 0;
  return createConfigurableSkillRunsService({
    appDir,
    idFactory: () => `run_${counter += 1}`,
    now: () => new Date(`2026-05-14T00:00:0${counter}.000Z`),
  });
}
