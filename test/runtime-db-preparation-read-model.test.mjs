import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeWorkspaceTree,
} from "../services/runtime-db-workspace-read-model.mjs";
import {
  runtimeMatterStatusFromWorkspaceState,
  runtimePrepareMatterPlanFromStatus,
  runtimeWorkspaceFilePaths,
} from "../services/runtime-db-preparation-read-model.mjs";

test("runtime DB preparation read model derives status and current rerun advice from payload custody", () => {
  const matter = { name: "DB Matter", matterName: "Legal Caption" };
  const objects = [
    objectRow("DB Matter/00_Inbox/Intake 01/File Register.csv", "2026-06-07T09:00:00.000Z"),
    objectRow("DB Matter/00_Inbox/Intake 01/_extracted/FILE-0001.json", "2026-06-07T10:00:00.000Z", {
      objectRole: "extraction_payload",
    }),
    objectRow("DB Matter/10_Library/Source Index.json", "2026-06-07T11:00:00.000Z"),
    objectRow("DB Matter/10_Library/List of Dates.md", "2026-06-07T12:00:00.000Z"),
  ];
  const tree = buildRuntimeWorkspaceTree({ matter, objects });

  const status = runtimeMatterStatusFromWorkspaceState({ matter, objects, tree });

  assert.equal(status.matterRoot, "postgres:DB Matter");
  assert.equal(status.matterName, "DB Matter");
  assert.equal(status.stages.every((stage) => stage.present), true);
  assert.deepEqual(
    runtimeWorkspaceFilePaths(tree.root).map((item) => item.path),
    [
      "00_Inbox/Intake 01/_extracted/FILE-0001.json",
      "00_Inbox/Intake 01/File Register.csv",
      "10_Library/List of Dates.md",
      "10_Library/Source Index.json",
    ],
  );
  assert.equal(status.stages.find((stage) => stage.slash === "/describe_sources").rerunAdvice.state, "current");
  assert.equal(status.stages.find((stage) => stage.slash === "/create_listofdates").rerunAdvice.state, "current");
});

test("runtime DB preparation read model marks downstream paid stages stale from newer DB inputs", () => {
  const matter = { name: "DB Matter", matterName: "Legal Caption" };
  const objects = [
    objectRow("DB Matter/00_Inbox/Intake 01/File Register.csv", "2026-06-07T09:00:00.000Z"),
    objectRow("DB Matter/00_Inbox/Intake 01/_extracted/FILE-0001.json", "2026-06-07T09:30:00.000Z", {
      objectRole: "extraction_payload",
    }),
    objectRow("DB Matter/10_Library/Source Index.json", "2026-06-07T11:00:00.000Z"),
    objectRow("DB Matter/10_Library/List of Dates.md", "2026-06-07T10:00:00.000Z"),
  ];
  const tree = buildRuntimeWorkspaceTree({ matter, objects });
  const status = runtimeMatterStatusFromWorkspaceState({ matter, objects, tree });

  const plan = runtimePrepareMatterPlanFromStatus({
    matter,
    dbMatter: {
      matterType: "Consumer",
      jurisdiction: "",
    },
    status,
  });

  const listStage = plan.stages.find((stage) => stage.slash === "/create_listofdates");
  assert.equal(listStage.state, "stale");
  assert.equal(listStage.action, "confirm_paid_run");
  assert.equal(listStage.rerunAdvice.newestInputPath, "10_Library/Source Index.json");
  assert.equal(plan.nextStep.slash, "/create_listofdates");
  assert.deepEqual(plan.metadata.missing, ["Client name", "Matter name", "Opposite party", "Jurisdiction"]);
});

test("runtime DB preparation read model blocks later stages when upstream DB artifacts are missing", () => {
  const matter = { name: "DB Matter" };
  const objects = [
    objectRow("DB Matter/00_Inbox/Intake 01/File Register.csv", "2026-06-07T09:00:00.000Z"),
  ];
  const tree = buildRuntimeWorkspaceTree({ matter, objects });
  const status = runtimeMatterStatusFromWorkspaceState({ matter, objects, tree });
  const plan = runtimePrepareMatterPlanFromStatus({
    matter,
    dbMatter: { clientName: "Client", matterName: "Legal Caption", oppositeParty: "Other", matterType: "Consumer", jurisdiction: "India" },
    status,
  });

  assert.equal(plan.stages.find((stage) => stage.slash === "/matter-init").state, "current");
  assert.equal(plan.stages.find((stage) => stage.slash === "/extract").state, "missing");
  assert.equal(plan.stages.find((stage) => stage.slash === "/describe_sources").state, "blocked");
  assert.equal(plan.nextStep.slash, "/extract");
  assert.equal(plan.nextStep.state, "missing");
});

function objectRow(objectKey, updatedAt, overrides = {}) {
  return {
    objectKey,
    objectRole: "matter_artifact",
    mimeType: "application/json",
    sizeBytes: 20,
    sha256: objectKey.padEnd(64, "a").slice(0, 64),
    updatedAt,
    hasPayload: true,
    fileId: "",
    originalName: "",
    documentSha: "",
    documentSizeBytes: 0,
    duplicateOf: "",
    ...overrides,
  };
}
