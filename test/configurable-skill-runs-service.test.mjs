import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
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

async function makeService() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "skill-runs-test-"));
  let counter = 0;
  return createConfigurableSkillRunsService({
    appDir,
    idFactory: () => `run_${counter += 1}`,
    now: () => new Date(`2026-05-14T00:00:0${counter}.000Z`),
  });
}
