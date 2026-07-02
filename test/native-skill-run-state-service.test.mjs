import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createNativeSkillRunStateService } from "../services/native-skill-run-state-service.mjs";

test("native skill run state service persists private stage outputs by run and stage", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-native-run-state-"));
  const statePath = path.join(tmp, "state.json");
  const service = createNativeSkillRunStateService({
    statePath,
    now: () => new Date("2026-07-02T00:00:00.000Z"),
  });

  await service.writeStageState({
    runId: "job_state_1",
    stageId: "proposer",
    summary: "Draft ready",
    value: { parsed: { short_diagnosis: "Draft" }, aiRun: { model: "gpt-5.5" } },
  });

  const restarted = createNativeSkillRunStateService({ statePath });
  const entry = await restarted.readStageState({ runId: "job_state_1", stageId: "proposer" });

  assert.equal(entry.runId, "job_state_1");
  assert.equal(entry.stageId, "proposer");
  assert.equal(entry.summary, "Draft ready");
  assert.deepEqual(entry.value.parsed, { short_diagnosis: "Draft" });
  assert.equal(entry.writtenAt, "2026-07-02T00:00:00.000Z");

  const raw = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(raw.schema_version, "native-skill-run-state-ledger/v1");
});

test("native skill run state service rejects unsafe identifiers", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-native-run-state-invalid-"));
  const service = createNativeSkillRunStateService({ statePath: path.join(tmp, "state.json") });

  await assert.rejects(
    () => service.writeStageState({ runId: "../../job", stageId: "proposer", value: {} }),
    /run id is required/,
  );
  await assert.rejects(
    () => service.writeStageState({ runId: "job_state_1", stageId: "Bad Stage", value: {} }),
    /stage id is required/,
  );
  assert.equal(await service.readStageValue({ runId: "../../job", stageId: "proposer" }), null);
});
