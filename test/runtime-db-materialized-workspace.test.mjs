import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  listRuntimeMatterFiles,
  materializeRuntimeWorkspacePayloads,
  sha256Bytes,
  synthesizeMissingFileRegisters,
} from "../services/runtime-db-materialized-workspace.mjs";

test("runtime DB materialized workspace helper writes payloads and synthesized matter metadata", async () => {
  const matterRoot = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-workspace-helper-"));
  const workspace = {
    tree: directory("", [
      file("10_Library/Note.txt"),
    ]),
  };

  const materialized = await materializeRuntimeWorkspacePayloads({
    matterRoot,
    matter: { name: "DB Matter", matterName: "Legal Caption", clientName: "Client A" },
    workspace,
    readPayloadRow: ({ relativePath }) => ({ bytes: Buffer.from(`payload:${relativePath}`) }),
  });

  assert.deepEqual(materialized, ["10_Library/Note.txt", "matter.json"]);
  assert.equal(await readFile(path.join(matterRoot, "10_Library", "Note.txt"), "utf8"), "payload:10_Library/Note.txt");
  assert.match(await readFile(path.join(matterRoot, "matter.json"), "utf8"), /Legal Caption/);
  assert.deepEqual(await listRuntimeMatterFiles(matterRoot), [
    { relativePath: "10_Library/Note.txt" },
    { relativePath: "matter.json" },
  ]);
  assert.equal(sha256Bytes(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("runtime DB materialized workspace helper synthesizes missing file registers from custody rows", async () => {
  const matterRoot = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-register-helper-"));
  const intakeDir = "00_Inbox/Intake 01 - Initial";
  await mkdir(path.join(matterRoot, intakeDir), { recursive: true });
  await writeFile(path.join(matterRoot, "matter.json"), JSON.stringify({
    intakes: [{ intake_id: "INTAKE-01", intake_dir: intakeDir }],
  }));

  const workspace = {
    tree: directory("", [
      file(`${intakeDir}/Source Files/notice-a.txt`, { fileId: "FILE-0001", originalName: "notice-a.txt", sha256: "a".repeat(64), size: 12 }),
      file(`${intakeDir}/Source Files/notice-b.txt`, { fileId: "FILE-0002", originalName: "notice-b.txt", sha256: "a".repeat(64), size: 12, duplicateOf: "FILE-0001" }),
    ]),
  };

  const created = await synthesizeMissingFileRegisters({ matterRoot, workspace });

  assert.deepEqual(created, [`${intakeDir}/File Register.csv`]);
  const register = await readFile(path.join(matterRoot, intakeDir, "File Register.csv"), "utf8");
  assert.match(register, /FILE-0001/);
  assert.match(register, /FILE-0002/);
  assert.match(register, /exact-duplicate/);
  assert.match(register, /runtime-db-storage-synthetic-register-v1/);
});

function directory(pathValue, children = []) {
  return { kind: "directory", path: pathValue, children };
}

function file(pathValue, overrides = {}) {
  return {
    kind: "file",
    path: pathValue,
    name: path.posix.basename(pathValue),
    ...overrides,
  };
}
