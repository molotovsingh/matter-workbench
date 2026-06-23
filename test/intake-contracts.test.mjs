import assert from "node:assert/strict";
import test from "node:test";

import {
  INTAKE_BATCH_SCHEMA_VERSION,
  INTAKE_CANDIDATE_SCHEMA_VERSION,
  INTAKE_SOURCE_BROWSER_UPLOAD,
  browserUploadBatchFromFiles,
  browserUploadCandidatesFromFiles,
} from "../services/intake/intake-contracts.mjs";

const files = [
  {
    index: 0,
    filename: "notice.pdf",
    tempPath: "/tmp/matter-upload-001/upload-00000",
    bytes: 1234,
  },
  {
    index: 1,
    filename: "Evidence/FIR.pdf",
    tempPath: "/tmp/matter-upload-001/upload-00001",
    bytes: 4567,
  },
];

test("browser upload candidates preserve source identity and normalized paths", () => {
  const candidates = browserUploadCandidatesFromFiles({
    files,
    relativePaths: ["notice.pdf", "Evidence/FIR.pdf"],
    action: "creating a matter",
  });

  assert.deepEqual(candidates, [
    {
      schema_version: INTAKE_CANDIDATE_SCHEMA_VERSION,
      sourceKind: INTAKE_SOURCE_BROWSER_UPLOAD,
      index: 0,
      originalName: "notice.pdf",
      relativePath: "notice.pdf",
      tempPath: "/tmp/matter-upload-001/upload-00000",
      sizeBytes: 1234,
    },
    {
      schema_version: INTAKE_CANDIDATE_SCHEMA_VERSION,
      sourceKind: INTAKE_SOURCE_BROWSER_UPLOAD,
      index: 1,
      originalName: "Evidence/FIR.pdf",
      relativePath: "Evidence/FIR.pdf",
      tempPath: "/tmp/matter-upload-001/upload-00001",
      sizeBytes: 4567,
    },
  ]);
});

test("browser upload batch wraps candidates without adding side effects", () => {
  const batch = browserUploadBatchFromFiles({
    action: "creating a matter",
    files,
    relativePaths: ["notice.pdf", "Evidence/FIR.pdf"],
  });

  assert.equal(batch.schema_version, INTAKE_BATCH_SCHEMA_VERSION);
  assert.equal(batch.sourceKind, INTAKE_SOURCE_BROWSER_UPLOAD);
  assert.equal(batch.action, "creating a matter");
  assert.equal(batch.candidateCount, 2);
  assert.deepEqual(
    batch.candidates.map((candidate) => candidate.relativePath),
    ["notice.pdf", "Evidence/FIR.pdf"],
  );
  assert.equal(batch.sizingReport.schema_version, "intake-sizing-report/v1");
  assert.equal(batch.sizingReport.recommendedPreparationMode, "immediate");
});

test("candidate contract keeps upload validation failures stable", () => {
  assert.throws(
    () => browserUploadCandidatesFromFiles({
      files: [{ index: 0 }, { index: 1 }],
      relativePaths: ["same.pdf", "SAME.pdf"],
    }),
    (error) => error.statusCode === 400
      && error.code === "upload.duplicate_paths"
      && /conflicts with/i.test(error.message),
  );

  assert.throws(
    () => browserUploadCandidatesFromFiles({
      files: [],
      relativePaths: [],
      action: "creating a matter",
    }),
    (error) => error.statusCode === 400
      && error.code === "upload.no_files_attached"
      && /creating a matter/i.test(error.message),
  );
});
