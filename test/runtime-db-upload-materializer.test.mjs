import assert from "node:assert/strict";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRuntimeUploadIntake } from "../services/runtime-db-upload-materializer.mjs";

test("runtime upload materializer produces storage files and import items", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-upload-materializer-"));
  const uploadedFile = path.join(tmp, "notice.txt");
  await writeFile(uploadedFile, "Notice served on 1 January 2026.");

  const unusedTempRoot = path.join(tmp, "unused-materialized-root");

  const { storageFiles, importItems } = await buildRuntimeUploadIntake({
    matter: { name: "Runtime Upload Matter" },
    metadata: {
      matterName: "Runtime Upload Matter",
      clientName: "Client",
      oppositeParty: "Opposite",
      matterType: "Civil",
      jurisdiction: "Delhi",
    },
    files: [{ index: 0, tempPath: uploadedFile, filename: "notice.txt" }],
    relativePaths: ["Evidence/notice.txt"],
    tempRoot: unusedTempRoot,
    intakeId: "INTAKE-01",
    intakeDirName: "Intake 01 - Initial",
    intakeLabel: "Initial",
    receivedDate: "2026-06-16",
    fileIdStart: 1,
  });

  const byPath = new Map(storageFiles.map((file) => [file.relativePath, file]));
  assert.ok(byPath.has("matter.json"));
  assert.ok(byPath.has("00_Inbox/Intake 01 - Initial/File Register.csv"));
  assert.ok(byPath.has("00_Inbox/Intake 01 - Initial/Source Files/Evidence/notice.txt"));
  assert.ok(byPath.has("00_Inbox/Intake 01 - Initial/Originals/Evidence/notice.txt"));
  assert.ok(byPath.has("00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__notice.txt"));
  assert.equal(byPath.get("matter.json").mimeType, "application/json");
  assert.equal(byPath.get("00_Inbox/Intake 01 - Initial/File Register.csv").mimeType, "text/csv");
  await assert.rejects(() => stat(unusedTempRoot), { code: "ENOENT" });
  assert.deepEqual(importItems, [
    {
      relativePath: "00_Inbox/Intake 01 - Initial/Source Files/Evidence/notice.txt",
      originalPath: "00_Inbox/Intake 01 - Initial/Originals/Evidence/notice.txt",
      workingCopyPath: "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__notice.txt",
      originalRelativePath: "Evidence/notice.txt",
      fileNumber: 1,
      fileId: "FILE-0001",
      sha256: "96d00548be07a3d02202890c366ad0094a19d57c3dfd1398a99874e061c0ef0f",
      duplicateOf: "",
    },
  ]);
});

test("runtime upload materializer treats numeric file.bytes as metadata, not payload", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-upload-materializer-bytes-"));
  const uploadedFile = path.join(tmp, "note.txt");
  await writeFile(uploadedFile, "Payload comes from temp path, not numeric size metadata.");

  const { storageFiles } = await buildRuntimeUploadIntake({
    matter: { name: "Runtime Upload Matter" },
    metadata: { matterName: "Runtime Upload Matter" },
    files: [{ index: 0, tempPath: uploadedFile, filename: "note.txt", bytes: 52 }],
    relativePaths: ["note.txt"],
    tempRoot: path.join(tmp, "unused-materialized-root"),
    intakeId: "INTAKE-01",
    intakeDirName: "Intake 01 - Initial",
    intakeLabel: "Initial",
    receivedDate: "2026-06-30",
    fileIdStart: 1,
  });

  const source = storageFiles.find((file) => file.relativePath === "00_Inbox/Intake 01 - Initial/Source Files/note.txt");
  assert.equal(source.bytes.toString("utf8"), "Payload comes from temp path, not numeric size metadata.");
});
