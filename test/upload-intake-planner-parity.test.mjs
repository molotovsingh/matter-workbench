import assert from "node:assert/strict";
import test from "node:test";

import {
  planAddFilesIntake,
  planNewMatterUpload,
} from "../shared/upload-intake-planner.mjs";
import {
  planNewRuntimeMatterUpload,
  planRuntimeAddFilesUpload,
} from "../services/runtime-db-upload-intake-planner.mjs";

const files = [{ index: 0, filename: "fir.pdf" }];

test("shared and runtime planners agree on new matter identity and upload paths", () => {
  const common = planNewMatterUpload({
    name: "State/Rajesh Mehra",
    metadata: {
      matterName: "State/Rajesh Mehra",
      clientName: "Rajesh Mehra",
      oppositeParty: "State",
    },
    files,
    relativePaths: ["Evidence/FIR.pdf"],
  });
  const runtime = planNewRuntimeMatterUpload({
    name: "State/Rajesh Mehra",
    metadata: {
      matterName: "State/Rajesh Mehra",
      clientName: "Rajesh Mehra",
      oppositeParty: "State",
    },
    files,
    relativePaths: ["Evidence/FIR.pdf"],
    actor: { id: "tester-user-id" },
    now: new Date("2026-06-16T09:15:00.000Z"),
  });

  assert.equal(common.storageName, "State - Rajesh Mehra");
  assert.equal(runtime.matter.name, common.storageName);
  assert.equal(runtime.matter.folderName, common.storageName);
  assert.equal(runtime.matter.matterName, common.metadata.matterName);
  assert.equal(runtime.matter.clientName, common.metadata.clientName);
  assert.deepEqual(runtime.relativePaths, common.relativePaths);
  assert.deepEqual(runtime.buildIntakeArgs.relativePaths, common.relativePaths);
});

test("shared and runtime planners agree on add-files intake allocation shape", () => {
  const common = planAddFilesIntake({
    label: "Follow Up",
    files,
    relativePaths: ["More Evidence/notice.pdf"],
    intakeNumber: 3,
    fileIdStart: 9,
    receivedDate: "2026-06-15",
  });
  const runtime = planRuntimeAddFilesUpload({
    matter: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "State - Rajesh Mehra",
      matterName: "State/Rajesh Mehra",
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
    files,
    relativePaths: ["More Evidence/notice.pdf"],
  });

  assert.equal(runtime.intakeNumber, common.intakeNumber);
  assert.equal(runtime.intakeId, common.intakeId);
  assert.equal(runtime.intakeDirName, common.intakeDirName);
  assert.equal(runtime.intakeDir, common.intakeDir);
  assert.equal(runtime.fileIdStart, common.fileIdStart);
  assert.equal(runtime.receivedDate, common.receivedDate);
  assert.deepEqual(runtime.relativePaths, common.relativePaths);
  assert.deepEqual(runtime.buildIntakeArgs.persistPaths, [
    "matter.json",
    `${common.intakeDir}/`,
  ]);
});

test("shared and runtime planners expose the same upload validation failures", () => {
  const invalidCommon = () => planNewMatterUpload({
    name: "Duplicate Matter",
    files: [{ index: 0 }, { index: 1 }],
    relativePaths: ["Evidence/FIR.pdf", "evidence/fir.pdf"],
  });
  const invalidRuntime = () => planNewRuntimeMatterUpload({
    name: "Duplicate Matter",
    files: [{ index: 0 }, { index: 1 }],
    relativePaths: ["Evidence/FIR.pdf", "evidence/fir.pdf"],
  });

  for (const plan of [invalidCommon, invalidRuntime]) {
    assert.throws(
      plan,
      (error) => error.statusCode === 400
        && error.code === "upload.duplicate_paths"
        && /conflicts with/i.test(error.message),
    );
  }
});
