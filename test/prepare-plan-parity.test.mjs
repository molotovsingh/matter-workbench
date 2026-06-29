import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMatterStatusService } from "../services/matter-status-service.mjs";
import { createPrepareMatterService } from "../services/prepare-matter-service.mjs";
import { createRuntimeDbStorageService } from "../services/runtime-db-storage-service.mjs";
import { PREPARE_STAGE_DEFINITIONS, prepareStageDefinition } from "../shared/preparation-stages.mjs";

const tenantId = "82dc5ad0-fb23-5c08-a06c-73232cd0281f";
const dbMatter = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "DB Matter",
  matterName: "Legal Caption",
  clientName: "Client A",
  oppositeParty: "Other Side",
  matterType: "Consumer",
  jurisdiction: "India",
};

function jsonSpawn(result) {
  return () => ({ status: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" });
}

function dbServiceWithMatter(matterRow) {
  return createRuntimeDbStorageService({
    databaseUrl: "postgres://mwb_user:fixture-pass@db.example/matter_workbench_shadow",
    tenantId,
    spawn: jsonSpawn({ matter: matterRow, objects: [] }),
  });
}

async function filesystemPlan() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-prepare-parity-"));
  const matterStore = {
    getMatterRoot: () => root,
    ensureMatterRoot: () => root,
    listIntakeFolders: async () => [],
    readMatterMetadata: async () => ({
      clientName: "Client A",
      matterName: "Legal Caption",
      oppositeParty: "Other Side",
      matterType: "Consumer",
      jurisdiction: "India",
      briefDescription: "",
    }),
  };
  const matterStatusService = createMatterStatusService({ matterStore });
  const service = createPrepareMatterService({ matterStore, matterStatusService });
  return service.readPrepareMatterPlan(root);
}

test("both storage modes serve preparation stages from the shared contract", async () => {
  const fsPlan = await filesystemPlan();
  const dbPlan = await dbServiceWithMatter(dbMatter).readPrepareMatterPlan(dbMatter);

  for (const plan of [fsPlan, dbPlan]) {
    for (const stage of plan.stages) {
      const definition = prepareStageDefinition(stage.slash);
      assert.ok(definition, `stage ${stage.slash} must exist in the shared contract`);
      assert.equal(stage.id, definition.id, stage.slash);
      assert.equal(stage.label, definition.label, stage.slash);
      assert.equal(stage.description, definition.description, stage.slash);
    }
  }

  const fsSlashes = fsPlan.stages.map((stage) => stage.slash);
  const dbSlashes = dbPlan.stages.map((stage) => stage.slash);
  const optionalStoryFamily = new Set(["/the_story", "/procedural_posture_diagnosis"]);
  assert.deepEqual(fsSlashes.filter((slash) => !optionalStoryFamily.has(slash)), dbSlashes);
  assert.deepEqual(
    PREPARE_STAGE_DEFINITIONS.map((definition) => definition.slash).filter((slash) => !optionalStoryFamily.has(slash)),
    dbSlashes,
  );
});

test("runtime DB prepare plan reports real missing metadata instead of hardcoded completeness", async () => {
  const incomplete = await dbServiceWithMatter({
    ...dbMatter,
    clientName: "",
    jurisdiction: "",
  }).readPrepareMatterPlan(dbMatter);

  assert.deepEqual(incomplete.metadata.missing, ["Client name", "Jurisdiction"]);
  assert.equal(incomplete.metadata.complete, false);
  assert.ok(
    incomplete.warnings.some((warning) => warning.includes("Missing metadata: Client name, Jurisdiction")),
    "missing metadata must surface as a plan warning",
  );

  const complete = await dbServiceWithMatter(dbMatter).readPrepareMatterPlan(dbMatter);
  assert.deepEqual(complete.metadata.missing, []);
  assert.equal(complete.metadata.complete, true);
});
