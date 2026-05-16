import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  listIntakeFolders,
  nextFileIdStart,
  nextIntakeNumber,
  priorHashIndex,
  registerHashSet,
} from "../services/matter-store-intakes.mjs";

test("matter intake helpers sort intake folders and derive register state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-store-intakes-"));
  await mkdir(path.join(root, "00_Inbox", "Intake 02 - Second"), { recursive: true });
  await mkdir(path.join(root, "00_Inbox", "Intake 01 - Initial"), { recursive: true });
  await mkdir(path.join(root, "00_Inbox", "Load_01_Legacy"), { recursive: true });
  await writeFile(path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"), [
    "file_id,sha256,status",
    "FILE-0001,hash-a,registered",
    "FILE-0002,hash-b,duplicate-of-prior-intake",
    "",
  ].join("\n"));
  await writeFile(path.join(root, "00_Inbox", "Intake 02 - Second", "File Register.csv"), [
    "file_id,sha256,status",
    "FILE-0010,hash-c,registered",
    "",
  ].join("\n"));

  assert.deepEqual(await listIntakeFolders(root), [
    { name: "Intake 01 - Initial", intakeNumber: 1 },
    { name: "Intake 02 - Second", intakeNumber: 2 },
  ]);
  assert.equal(await nextIntakeNumber(root), 3);
  assert.equal(await nextFileIdStart(root), 11);
  assert.deepEqual(await registerHashSet(root), new Set(["hash-a", "hash-b", "hash-c"]));
  assert.deepEqual(await priorHashIndex(root), new Map([
    ["hash-a", "FILE-0001"],
    ["hash-c", "FILE-0010"],
  ]));
});

test("matter intake helpers tolerate missing inbox and registers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "matter-store-intakes-empty-"));
  assert.deepEqual(await listIntakeFolders(root), []);
  assert.equal(await nextIntakeNumber(root), 1);
  assert.equal(await nextFileIdStart(root), 1);
  assert.deepEqual(await registerHashSet(root), new Set());
  assert.deepEqual(await priorHashIndex(root), new Map());
});
