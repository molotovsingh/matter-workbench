import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseUploadJsonField,
  planBrowserAddFilesUpload,
  planBrowserNewMatterUpload,
  validateUploadPathList,
} from "../services/intake/browser-upload-adapter.mjs";

const files = [
  {
    index: 0,
    filename: "notice.pdf",
    tempPath: "/tmp/upload-00000",
    bytes: 10,
  },
];

test("browser adapter plans new matter upload from multipart fields", () => {
  const result = planBrowserNewMatterUpload({
    fields: {
      name: "State/Rajesh Mehra",
      metadata: JSON.stringify({
        matterName: "State/Rajesh Mehra",
        clientName: "Rajesh Mehra",
        oppositeParty: "State",
      }),
      paths: JSON.stringify(["evidence/notice.pdf"]),
    },
    files,
  });

  assert.equal(result.submittedMatterName, "State/Rajesh Mehra");
  assert.equal(result.identityPlan.storageName, "State - Rajesh Mehra");
  assert.equal(result.uploadPlan.storageName, "State - Rajesh Mehra");
  assert.equal(result.metadata.clientName, "Rajesh Mehra");
  assert.deepEqual(result.relativePaths, ["evidence/notice.pdf"]);
  assert.equal(result.batch.sourceKind, "browser_upload");
  assert.equal(result.batch.candidateCount, 1);
});

test("browser adapter plans add-files upload from multipart fields", () => {
  const result = planBrowserAddFilesUpload({
    fields: {
      label: "Follow Up",
      paths: JSON.stringify(["receipt.pdf"]),
    },
    files,
  });

  assert.equal(result.label, "Follow Up");
  assert.deepEqual(result.relativePaths, ["receipt.pdf"]);
  assert.equal(result.batch.action, "adding files");
  assert.equal(result.batch.candidateCount, 1);
});

test("browser adapter preserves invalid JSON and no-file error codes", () => {
  assert.throws(
    () => parseUploadJsonField({ metadata: "{" }, "metadata", {}),
    (error) => error.statusCode === 400
      && error.code === "upload.invalid_json"
      && /Invalid metadata JSON/.test(error.message),
  );

  assert.throws(
    () => validateUploadPathList({ paths: JSON.stringify([]) }, [], { action: "creating a matter" }),
    (error) => error.statusCode === 400
      && error.code === "upload.no_files_attached",
  );
});

test("legacy upload-file-intake re-exports adapter parsing functions", async () => {
  const source = await readFile("services/upload-file-intake.mjs", "utf8");
  assert.match(source, /from "\.\/intake\/browser-upload-adapter\.mjs"/);
  assert.match(source, /parseUploadJsonField/);
  assert.match(source, /validateUploadPathList/);
});
