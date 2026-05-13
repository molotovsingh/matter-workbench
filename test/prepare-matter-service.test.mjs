import assert from "node:assert/strict";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMatterStatusService } from "../services/matter-status-service.mjs";
import { createPrepareMatterService } from "../services/prepare-matter-service.mjs";

function createStore(root) {
  return {
    getMatterRoot: () => root,
    ensureMatterRoot: () => {
      if (!root) throw new Error("No matter");
      return root;
    },
    listIntakeFolders: async () => [{ name: "Intake 01 - Initial", intakeNumber: 1 }],
    readMatterMetadata: async () => ({
      clientName: "Client",
      matterName: "Client v Opponent",
      oppositeParty: "Opponent",
      matterType: "Civil",
      jurisdiction: "India",
      briefDescription: "",
    }),
  };
}

function createService(root) {
  const matterStore = createStore(root);
  const matterStatusService = createMatterStatusService({ matterStore });
  return createPrepareMatterService({ matterStore, matterStatusService });
}

test("prepare matter plan handles no active matter without throwing", async () => {
  const service = createPrepareMatterService({
    matterStore: createStore(null),
    matterStatusService: {
      readMatterStatus: async () => {
        throw new Error("should not be called");
      },
    },
  });

  const plan = await service.readPrepareMatterPlan();
  assert.equal(plan.schema_version, "prepare-matter-plan/v1");
  assert.equal(plan.nextStep.state, "not_selected");
  assert.deepEqual(plan.stages, []);
});

test("prepare matter plan skips setup and asks before paid source labeling", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prepare-matter-source-test-"));
  await mkdir(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), JSON.stringify({
    matter_name: "Client v Opponent",
    client_name: "Client",
    opposite_party: "Opponent",
    matter_type: "Civil",
    jurisdiction: "India",
  }));
  await writeFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"), "file_id\nFILE-0001\n");
  await writeFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "Extraction Log.csv"), "file_id,status\nFILE-0001,extracted\n");
  await writeFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", "FILE-0001.json"), "{}\n");

  const plan = await createService(root).readPrepareMatterPlan();
  assert.deepEqual(plan.stages.map((stage) => [stage.slash, stage.state, stage.action]), [
    ["/matter-init", "current", "skip_current"],
    ["/extract", "current", "skip_current"],
    ["/describe_sources", "missing", "confirm_paid_run"],
  ]);
  assert.equal(plan.nextStep.slash, "/describe_sources");
  assert.match(plan.nextStep.message, /confirm paid source labeling/i);
  assert.ok(plan.warnings.some((warning) => /paid AI provider call/i.test(warning)));
  assert.equal(plan.downstream.listOfDates.action, "recommend_after_prepare");
});

test("prepare matter plan blocks source labeling when extraction has no usable records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prepare-matter-empty-extract-test-"));
  await mkdir(path.join(root, "00_Inbox", "Intake 01 - Initial"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), JSON.stringify({
    matter_name: "Client v Opponent",
    client_name: "Client",
    opposite_party: "Opponent",
    matter_type: "Civil",
    jurisdiction: "India",
  }));
  await writeFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"), "file_id\nFILE-0001\n");
  await writeFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "Extraction Log.csv"), "file_id,status\nFILE-0001,skipped-unsupported-format\n");

  const plan = await createService(root).readPrepareMatterPlan();
  assert.deepEqual(plan.stages.map((stage) => [stage.slash, stage.state, stage.action]), [
    ["/matter-init", "current", "skip_current"],
    ["/extract", "blocked", "blocked"],
    ["/describe_sources", "blocked", "blocked"],
  ]);
  assert.equal(plan.nextStep.slash, "/extract");
  assert.match(plan.nextStep.message, /no usable extraction records/i);
  assert.equal(plan.downstream.listOfDates.action, "recommend_after_prepare");
});

test("prepare matter plan skips current source labels and recommends list of dates separately", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prepare-matter-current-test-"));
  const extractedDir = path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted");
  const libraryDir = path.join(root, "10_Library");
  await mkdir(extractedDir, { recursive: true });
  await mkdir(libraryDir, { recursive: true });
  await writeFile(path.join(root, "matter.json"), JSON.stringify({
    matter_name: "Client v Opponent",
    client_name: "Client",
    opposite_party: "Opponent",
    matter_type: "Civil",
    jurisdiction: "India",
  }));
  await writeFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"), "file_id\nFILE-0001\n");
  const recordPath = path.join(extractedDir, "FILE-0001.json");
  const sourceIndexPath = path.join(libraryDir, "Source Index.json");
  await writeFile(recordPath, "{}\n");
  await writeFile(sourceIndexPath, JSON.stringify({
    generated_at: "2026-05-13T10:00:00.000Z",
    ai_run: {
      provider: "openrouter",
      model: "openai/gpt-4.1",
      returnedProvider: "Friendli",
    },
  }));
  const oldDate = new Date("2026-05-13T09:00:00.000Z");
  const currentDate = new Date("2026-05-13T10:00:00.000Z");
  await utimes(recordPath, oldDate, oldDate);
  await utimes(sourceIndexPath, currentDate, currentDate);

  const plan = await createService(root).readPrepareMatterPlan();
  assert.deepEqual(plan.stages.map((stage) => [stage.slash, stage.action]), [
    ["/matter-init", "skip_current"],
    ["/extract", "skip_current"],
    ["/describe_sources", "skip_current"],
  ]);
  assert.equal(plan.nextStep.state, "complete");
  assert.equal(plan.downstream.listOfDates.action, "recommend_separate_skill");
  assert.match(plan.downstream.listOfDates.reason, /Run Create list of dates separately/i);
});

test("prepare matter plan blocks when required metadata is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prepare-matter-metadata-test-"));
  await mkdir(path.join(root, "00_Inbox", "Intake 01 - Initial"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), JSON.stringify({
    matter_name: "Client v Opponent",
  }));
  const matterStore = {
    ...createStore(root),
    readMatterMetadata: async () => ({
      clientName: "",
      matterName: "Client v Opponent",
      oppositeParty: "",
      matterType: "",
      jurisdiction: "",
      briefDescription: "",
    }),
  };
  const matterStatusService = createMatterStatusService({ matterStore });
  const plan = await createPrepareMatterService({ matterStore, matterStatusService }).readPrepareMatterPlan();

  assert.equal(plan.stages[0].slash, "/matter-init");
  assert.equal(plan.stages[0].action, "blocked");
  assert.equal(plan.nextStep.state, "blocked");
  assert.ok(plan.metadata.missing.includes("Client name"));
  assert.ok(plan.metadata.missing.includes("Opposite party"));
});
