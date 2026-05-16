import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(repoRoot, "scripts", "matter-attention-report.mjs");

test("matter attention report CLI summarizes all matters without switching active matter", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-attention-report-test-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const brokenRoot = path.join(mattersHome, "Broken Matter");
  const clearRoot = path.join(mattersHome, "Clear Matter");
  await mkdir(brokenRoot, { recursive: true });
  await writeClearMatter(clearRoot);
  await mkdir(appDir, { recursive: true });

  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    "--app-dir",
    appDir,
    "--matters-home",
    mattersHome,
    "--json",
  ], { cwd: repoRoot });

  const report = JSON.parse(stdout);
  assert.equal(report.schema_version, "matter-attention-report/v1");
  assert.equal(report.mattersHome, mattersHome);
  assert.equal(report.summary.matters, 2);
  assert.equal(report.summary.blocked, 1);
  assert.equal(report.summary.clear, 1);

  const broken = report.matters.find((matter) => matter.matterName === "Broken Matter");
  assert.equal(broken.summary.state, "blocked");
  assert.ok(broken.items.some((item) => item.code === "matter_json_missing"));

  const clear = report.matters.find((matter) => matter.matterName === "Clear Matter");
  assert.equal(clear.summary.state, "clear");
});

test("matter attention report CLI can print a compact problem-only text report", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-attention-report-text-test-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  await mkdir(path.join(mattersHome, "Broken Matter"), { recursive: true });
  await writeClearMatter(path.join(mattersHome, "Clear Matter"));
  await mkdir(appDir, { recursive: true });

  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    "--app-dir",
    appDir,
    "--matters-home",
    mattersHome,
    "--only-problems",
  ], { cwd: repoRoot });

  assert.match(stdout, /Matter Attention Report/);
  assert.match(stdout, /BLOCKED Broken Matter/);
  assert.doesNotMatch(stdout, /CLEAR Clear Matter/);
});

async function writeClearMatter(root) {
  const intakeDir = path.join(root, "00_Inbox", "Intake 01 - Initial");
  const extractedDir = path.join(intakeDir, "_extracted");
  const workingCopy = path.join(intakeDir, "By Type", "Text Notes", "FILE-0001__facts.txt");
  await mkdir(path.dirname(workingCopy), { recursive: true });
  await mkdir(extractedDir, { recursive: true });
  await mkdir(path.join(root, "10_Library"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), "{}\n");
  await writeFile(workingCopy, "Facts\n");
  await writeFile(path.join(extractedDir, "FILE-0001.json"), "{}\n");
  await writeFile(path.join(intakeDir, "File Register.csv"), [
    "file_id,intake_id,working_copy_path,category,status,notes",
    "FILE-0001,INTAKE-01,00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt,Text Notes,unique,",
    "",
  ].join("\n"));
  await writeFile(path.join(intakeDir, "Extraction Log.csv"), [
    "file_id,intake_id,status,notes",
    "FILE-0001,INTAKE-01,extracted,",
    "",
  ].join("\n"));
  await writeFile(path.join(root, "10_Library", "Source Index.json"), `${JSON.stringify({
    source_record_count: 1,
    sources: [
      {
        source_id: "source-1",
        file_id: "FILE-0001",
        display_label: "Client chronology note dated 1 May 2026",
        short_label: "Client chronology note",
        label_status: "confirmed",
        needs_review: false,
      },
    ],
  })}\n`);
  await writeFile(path.join(root, "10_Library", "List of Dates.md"), "# List of Dates\n");
  await writeFile(path.join(root, "10_Library", "List of Dates.json"), `${JSON.stringify({
    entries: [],
  })}\n`);
}
