import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDoctorFix, runDoctorScan } from "../services/doctor-service.mjs";

test("doctor migrates legacy intake layout and backs up edited files", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-doctor-test-"));
  const root = path.join(tmp, "matter");
  const legacyDir = path.join(root, "00_Inbox", "Load_01_Initial");
  await mkdir(path.join(legacyDir, "Evidence Files"), { recursive: true });
  await mkdir(path.join(legacyDir, "raw_source_files"), { recursive: true });
  await mkdir(path.join(legacyDir, "arranged_files", "documents_pdf"), { recursive: true });
  await writeFile(path.join(legacyDir, "Inbox_Loads.csv"), "load_id,load_dir,raw_source_dir,arranged_dir,raw_files_copied,arranged_files_copied,duplicate_files\nLOAD-01,00_Inbox/Load_01_Initial,raw_source_files,arranged_files,1,1,0\n");
  await writeFile(path.join(legacyDir, "Inbox_Normalization_Log.csv"), "raw_file_id,load_id,preserved_path,arranged_path,source_sha256,duplicate_of_raw_file_id\nRAW-0001,LOAD-01,raw_source_files/a.pdf,arranged_files/documents_pdf/a.pdf,abc,\n");
  await writeFile(path.join(root, "matter.json"), JSON.stringify({
    matter_name: "Legacy Matter",
    phase_1_intake: {
      load_id: "LOAD-01",
      load_dir: "00_Inbox/Load_01_Initial",
      raw_source_dir: "00_Inbox/Load_01_Initial/raw_source_files",
      arranged_dir: "00_Inbox/Load_01_Initial/arranged_files",
      load_log: "00_Inbox/Load_01_Initial/Inbox_Loads.csv",
      normalization_log: "00_Inbox/Load_01_Initial/Inbox_Normalization_Log.csv",
    },
  }, null, 2));

  const scan = await runDoctorScan(root);
  assert.equal(scan.issues.length, 1);
  assert.equal(scan.issues[0].id, "legacy-layout");

  const fixed = await runDoctorFix(root, ["legacy-layout"]);
  assert.equal(fixed.failed.length, 0);
  assert.equal(fixed.applied.length, 1);
  await stat(path.join(root, "00_Inbox", "Intake 01 - Initial", "Source Files"));
  await stat(path.join(root, "00_Inbox", "Intake 01 - Initial", "Originals"));
  await stat(path.join(root, "00_Inbox", "Intake 01 - Initial", "By Type", "PDFs"));
  await stat(path.join(root, "00_Inbox", "Intake 01 - Initial", "Intake Log.csv"));
  await stat(path.join(root, "00_Inbox", "Intake 01 - Initial", "File Register.csv"));
  await stat(path.join(root, fixed.applied[0].backupDir, "matter.json"));

  const migrated = JSON.parse(await readFile(path.join(root, "matter.json"), "utf8"));
  assert.equal(Array.isArray(migrated.intakes), true);
  assert.equal(migrated.phase_1_intake, undefined);
  assert.equal((await runDoctorScan(root)).issues.length, 0);
});
