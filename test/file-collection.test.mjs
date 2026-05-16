import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFileUploadFormData,
  collectFilesFromInput,
  hashCollectedFiles,
} from "../frontend/file-collection.js";

test("collectFilesFromInput strips top folder from webkitRelativePath", () => {
  const file = new File(["alpha"], "source.pdf");
  Object.defineProperty(file, "webkitRelativePath", { value: "Client Uploads/Batch A/source.pdf" });

  assert.deepEqual(collectFilesFromInput({ files: [file] }), [{
    file,
    relativePath: "Batch A/source.pdf",
  }]);
});

test("hashCollectedFiles returns SHA-256 hashes in file order", async () => {
  const files = [
    { file: new File(["alpha"], "a.txt"), relativePath: "a.txt" },
    { file: new File(["beta"], "b.txt"), relativePath: "b.txt" },
  ];

  assert.deepEqual(await hashCollectedFiles(files), [
    "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8",
    "f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753",
  ]);
});

test("buildFileUploadFormData appends fields, paths, and file blobs", async () => {
  const file = new File(["alpha"], "source.pdf", { type: "application/pdf" });
  const formData = buildFileUploadFormData(
    [{ file, relativePath: "Batch A/source.pdf" }],
    { name: "Ayesha Vs Japan Airlines", metadata: JSON.stringify({ clientName: "Ayesha" }) },
  );

  assert.equal(formData.get("name"), "Ayesha Vs Japan Airlines");
  assert.equal(formData.get("metadata"), JSON.stringify({ clientName: "Ayesha" }));
  assert.equal(formData.get("paths"), JSON.stringify(["Batch A/source.pdf"]));
  assert.equal(formData.getAll("files").length, 1);
  assert.equal(await formData.get("files").text(), "alpha");
});
