import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const evalScript = new URL("../evals/listofdates/check-golden-listofdates.mjs", import.meta.url);

test("golden Case Timeline evaluation prefers canonical artifacts and retains legacy fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "case-timeline-golden-"));
  const casesDir = path.join(root, "cases");
  const mattersDir = path.join(root, "matters");

  await writeGoldenCase(casesDir, "case_canonical", "Canonical Matter", "FILE-0001");
  await writeGeneratedTimeline(mattersDir, "canonical-matter", "Canonical Matter", "Case Timeline.md", "FILE-0001");
  await writeGoldenCase(casesDir, "case_legacy", "Legacy Matter", "FILE-0002");
  await writeGeneratedTimeline(mattersDir, "legacy-matter", "Legacy Matter", "List of Dates.md", "FILE-0002");

  const { stdout } = await execFileAsync(process.execPath, [
    evalScript.pathname,
    "--cases-dir", casesDir,
    "--matters-dir", mattersDir,
    "--json",
  ]);
  const report = JSON.parse(stdout);

  assert.equal(report.summary.ok, true);
  assert.equal(report.summary.missingArtifactCases, 0);
  assert.match(report.results.find((result) => result.matterName === "Canonical Matter").generatedPath, /Case Timeline\.md$/);
  assert.match(report.results.find((result) => result.matterName === "Legacy Matter").generatedPath, /List of Dates\.md$/);
});

async function writeGoldenCase(casesDir, caseName, matterName, fileId) {
  const caseDir = path.join(casesDir, caseName);
  await mkdir(caseDir, { recursive: true });
  await writeFile(path.join(caseDir, "GOLDEN_LIST_OF_DATES.md"), [
    `Matter: ${matterName}`,
    "",
    "## Expected events",
    "",
    "| # | Date | Event | Citation |",
    "| --- | --- | --- | --- |",
    `| 1 | 2026-01-01 | Notice issued. | ${fileId} p1.b1 |`,
    "",
  ].join("\n"));
}

async function writeGeneratedTimeline(mattersDir, matterDirName, matterName, fileName, fileId) {
  const libraryDir = path.join(mattersDir, matterDirName, "10_Library");
  await mkdir(libraryDir, { recursive: true });
  await writeFile(path.join(libraryDir, fileName), [
    "# Case Timeline",
    "",
    `Matter: ${matterName}`,
    "",
    "| Date | Event | Source |",
    "| --- | --- | --- |",
    `| 2026-01-01 | Notice issued. | Notice (${fileId} p1.b1) |`,
    "",
  ].join("\n"));
}
