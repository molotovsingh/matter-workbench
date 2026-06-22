import assert from "node:assert/strict";
import test from "node:test";

import { detectRuntimeDbLegacyLayout } from "../services/runtime-db-doctor-scan.mjs";

test("runtime DB doctor scan detects legacy folder, CSV, and matter metadata shapes", () => {
  const issue = detectRuntimeDbLegacyLayout({
    paths: [
      { path: "00_Inbox/Load_001_Initial/Evidence Files/notice.pdf" },
      { path: "00_Inbox/Load_001_Initial/raw_source_files/notice.pdf" },
      { path: "00_Inbox/Load_001_Initial/arranged_files/documents_pdf/notice.pdf" },
      { path: "00_Inbox/Load_001_Initial/Inbox_Loads.csv" },
      { path: "00_Inbox/Load_001_Initial/Inbox_Normalization_Log.csv" },
      { path: "matter.json" },
    ],
    readText: (relativePath) => {
      if (relativePath.endsWith(".csv")) return "raw_file_id,preserved_path,arranged_path\nFILE-0001,old,new\n";
      if (relativePath === "matter.json") return JSON.stringify({ phase_1_intake: { intake_id: "INTAKE-01" } });
      return null;
    },
  });

  assert.equal(issue.id, "legacy-layout");
  assert.equal(issue.severity, "warning");
  assert.equal(issue.autoFixable, true);
  assert.equal(issue.evidence.legacyLoadDir, "Load_001_Initial");
  assert.equal(issue.evidence.hasLegacyEvidenceFiles, true);
  assert.equal(issue.evidence.hasLegacyRawSourceFiles, true);
  assert.equal(issue.evidence.hasLegacyArrangedFiles, true);
  assert.deepEqual(issue.evidence.legacyCategoryDirs, ["documents_pdf"]);
  assert.equal(issue.evidence.hasLegacyLoadCsv, true);
  assert.equal(issue.evidence.hasLegacyNormalizationCsv, true);
  assert.deepEqual(issue.evidence.legacyCsvColumns, ["raw_file_id", "preserved_path", "arranged_path"]);
  assert.equal(issue.evidence.hasLegacyMatterJsonKey, true);
  assert.match(issue.description, /Load_001_Initial/);
  assert.match(issue.description, /documents_pdf/);
});

test("runtime DB doctor scan ignores current-layout matter paths", () => {
  const issue = detectRuntimeDbLegacyLayout({
    paths: [
      { path: "00_Inbox/Intake 01 - Initial/Source Files/notice.pdf" },
      { path: "00_Inbox/Intake 01 - Initial/Originals/notice.pdf" },
      { path: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0001__notice.pdf" },
      { path: "00_Inbox/Intake 01 - Initial/File Register.csv" },
      { path: "matter.json" },
    ],
    readText: (relativePath) => {
      if (relativePath === "00_Inbox/Intake 01 - Initial/File Register.csv") {
        return "file_id,source_path,working_copy_path\nFILE-0001,notice.pdf,FILE-0001__notice.pdf\n";
      }
      if (relativePath === "matter.json") return JSON.stringify({ intakes: [{ intake_id: "INTAKE-01" }] });
      return null;
    },
  });

  assert.equal(issue, null);
});
