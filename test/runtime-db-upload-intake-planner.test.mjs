import assert from "node:assert/strict";
import test from "node:test";
import {
  planNewRuntimeMatterUpload,
  planRuntimeAddFilesUpload,
} from "../services/runtime-db-upload-intake-planner.mjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("runtime upload planner creates safe DB identity while preserving legal matter caption", () => {
  const plan = planNewRuntimeMatterUpload({
    name: "State/Rajesh Mehra",
    metadata: {
      matterName: "State/Rajesh Mehra",
      clientName: "Rajesh Mehra",
      oppositeParty: "State",
      matterType: "Criminal",
      jurisdiction: "Delhi",
    },
    files: [{ index: 0 }],
    relativePaths: ["FIR.pdf"],
    actor: { id: "tester-user-id" },
    now: new Date("2026-06-16T09:15:00.000Z"),
  });

  assert.equal(plan.matter.name, "State - Rajesh Mehra");
  assert.equal(plan.matter.folderName, "State - Rajesh Mehra");
  assert.equal(plan.matter.matterName, "State/Rajesh Mehra");
  assert.equal(plan.matter.clientName, "Rajesh Mehra");
  assert.equal(plan.matter.createdByUserId, "tester-user-id");
  assert.match(plan.matter.id, uuidPattern);
  assert.equal(plan.intakeDbId, plan.buildIntakeArgs.intakeDbId);
  assert.equal(plan.uploadSessionId, plan.buildIntakeArgs.uploadSessionId);
  assert.equal(plan.importBatchId, plan.buildIntakeArgs.importBatchId);
  assert.equal(plan.receivedDate, "2026-06-16");
  assert.deepEqual(plan.relativePaths, ["FIR.pdf"]);
  assert.deepEqual(plan.buildIntakeArgs, {
    matter: plan.matter,
    metadata: plan.matter,
    files: [{ index: 0 }],
    relativePaths: ["FIR.pdf"],
    intakeDbId: plan.intakeDbId,
    uploadSessionId: plan.uploadSessionId,
    importBatchId: plan.importBatchId,
    intakeId: "INTAKE-01",
    intakeDirName: "Intake 01 - Initial",
    intakeLabel: "Initial",
    receivedDate: "2026-06-16",
    fileIdStart: 1,
  });
});

test("runtime upload planner rejects empty and colliding uploads with stable codes", () => {
  assert.throws(
    () => planNewRuntimeMatterUpload({
      name: "Empty Matter",
      metadata: { matterName: "Empty Matter" },
      files: [],
      relativePaths: [],
    }),
    (error) => error.statusCode === 400
      && error.code === "upload.no_files_attached"
      && /attach at least one source file/i.test(error.message),
  );

  assert.throws(
    () => planNewRuntimeMatterUpload({
      name: "Duplicate Matter",
      metadata: { matterName: "Duplicate Matter" },
      files: [{ index: 0 }, { index: 1 }],
      relativePaths: ["Evidence/FIR.pdf", "evidence/fir.pdf"],
    }),
    (error) => error.statusCode === 400
      && error.code === "upload.duplicate_paths"
      && /conflicts with/i.test(error.message),
  );
});

test("runtime upload planner converts runtime DB allocation into add-files intake plan", () => {
  const plan = planRuntimeAddFilesUpload({
    matter: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "State - Rajesh Mehra",
      matterName: "State/Rajesh Mehra",
      clientName: "Rajesh Mehra",
    },
    allocation: {
      matter: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "State - Rajesh Mehra",
        nextFileNumber: 9,
      },
      nextIntakeNumber: 3,
      fileIdStart: 9,
      intakeDbId: "22222222-2222-4222-8222-222222222222",
      uploadSessionId: "33333333-3333-4333-8333-333333333333",
      receivedDate: "2026-06-15",
    },
    label: "Follow Up",
    files: [{ index: 0 }],
    relativePaths: ["More Evidence/notice.pdf"],
    now: new Date("2026-06-16T09:15:00.000Z"),
  });

  assert.equal(plan.matter.name, "State - Rajesh Mehra");
  assert.equal(plan.intakeNumber, 3);
  assert.equal(plan.intakeId, "INTAKE-03");
  assert.equal(plan.intakeDirName, "Intake 03 - 2026-06-15 Follow Up");
  assert.equal(plan.intakeDir, "00_Inbox/Intake 03 - 2026-06-15 Follow Up");
  assert.equal(plan.fileIdStart, 9);
  assert.equal(plan.intakeDbId, "22222222-2222-4222-8222-222222222222");
  assert.equal(plan.uploadSessionId, "33333333-3333-4333-8333-333333333333");
  assert.match(plan.importBatchId, uuidPattern);
  assert.deepEqual(plan.buildIntakeArgs, {
    matter: plan.matter,
    metadata: plan.matter,
    files: [{ index: 0 }],
    relativePaths: ["More Evidence/notice.pdf"],
    intakeDbId: "22222222-2222-4222-8222-222222222222",
    uploadSessionId: "33333333-3333-4333-8333-333333333333",
    importBatchId: plan.importBatchId,
    intakeId: "INTAKE-03",
    intakeDirName: "Intake 03 - 2026-06-15 Follow Up",
    intakeLabel: "Follow Up",
    receivedDate: "2026-06-15",
    fileIdStart: 9,
    materializeExisting: true,
    persistPaths: [
      "matter.json",
      "00_Inbox/Intake 03 - 2026-06-15 Follow Up/",
    ],
  });
});
