import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const helperPath = new URL("../react-ui/src/lib/uploadFileCollection.ts", import.meta.url);
const uploadPreflightPath = new URL("../react-ui/src/lib/uploadBatchPreflight.ts", import.meta.url);
const newMatterPath = new URL("../react-ui/src/views/NewMatterForm.tsx", import.meta.url);
const addFilesPath = new URL("../react-ui/src/views/AddFilesForm.tsx", import.meta.url);
const uploadTelemetryPath = new URL("../react-ui/src/lib/uploadClientTelemetry.ts", import.meta.url);

test("React upload file collection drains every directory reader batch", async () => {
  const { collectDroppedEntries } = await importHelper();
  const first = fakeFileEntry("first.pdf");
  const second = fakeFileEntry("second.pdf");
  const nested = fakeDirectoryEntry("Nested", [
    [fakeFileEntry("third.pdf")],
    [],
  ]);
  const root = fakeDirectoryEntry("Bundle", [
    [first],
    [second, nested],
    [],
  ]);

  const collected = await collectDroppedEntries([root]);

  assert.deepEqual(
    collected.map((item) => item.relativePath),
    [
      "Bundle/first.pdf",
      "Bundle/second.pdf",
      "Bundle/Nested/third.pdf",
    ],
  );
});

test("React upload file collection detects duplicate relative paths", async () => {
  const { findDuplicateRelativePath } = await importHelper();

  assert.equal(findDuplicateRelativePath([
    { relativePath: "Notice.pdf", file: { name: "Notice.pdf" } },
    { relativePath: "notice.pdf", file: { name: "notice.pdf" } },
  ]), "Notice.pdf / notice.pdf");
  assert.equal(findDuplicateRelativePath([
    { relativePath: "Bundle/notice.pdf", file: { name: "notice.pdf" } },
    { relativePath: "Bundle/receipt.pdf", file: { name: "receipt.pdf" } },
  ]), "");
});

test("React upload preflight blocks batches over the configured byte limit", async () => {
  const { assessUploadBatchSize } = await importUploadPreflight();

  assert.deepEqual(
    assessUploadBatchSize([
      { relativePath: "small.pdf", file: { name: "small.pdf", size: 4 } },
      { relativePath: "second.pdf", file: { name: "second.pdf", size: 5 } },
    ], 10),
    { ok: true, totalBytes: 9, maxBytes: 10, message: "" },
  );

  const blocked = assessUploadBatchSize([
    { relativePath: "too-large.pdf", file: { name: "too-large.pdf", size: 11 } },
  ], 10);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.totalBytes, 11);
  assert.equal(blocked.maxBytes, 10);
  assert.match(blocked.message, /too large for one upload/i);
  assert.match(blocked.message, /10 B/);
});

test("React new-matter and add-files forms share folder-aware upload collection helpers", async () => {
  const newMatter = await readFile(newMatterPath, "utf8");
  const addFiles = await readFile(addFilesPath, "utf8");

  for (const source of [newMatter, addFiles]) {
    assert.match(source, /collectDroppedEntries/);
    assert.match(source, /collectFilesFromFileList/);
    assert.match(source, /findDuplicateRelativePath/);
  }
  assert.match(newMatter, /webkitdirectory/);
  assert.match(newMatter, /files\.slice\(0, 20\)/);
  assert.match(newMatter, /\+{files\.length - 20} more/);
  assert.doesNotMatch(newMatter, /Array\.from\(e\.dataTransfer\.files\)/);
  assert.doesNotMatch(addFiles, /function walkEntries/);
});

test("React upload inputs copy selected files before clearing the browser input", async () => {
  const newMatter = await readFile(newMatterPath, "utf8");
  const addFiles = await readFile(addFilesPath, "utf8");

  for (const source of [newMatter, addFiles]) {
    assert.match(source, /const input = e\.currentTarget;/);
    assert.match(source, /const selectedFiles = collectFilesFromFileList\(Array\.from\(input\.files \?\? \[\]\)\);/);
    assert.match(source, /if \(selectedFiles\.length > 0\)/);
    assert.match(source, /window\.setTimeout\(\(\) => \{\s*input\.value = '';\s*\}, 0\);/s);
    assert.doesNotMatch(source, /collectFilesFromFileList\(e\.target\.files\)/);
    assert.doesNotMatch(source, /e\.target\.value = ''/);
  }
});

test("React new-matter form presents source files as required before submit", async () => {
  const newMatter = await readFile(newMatterPath, "utf8");

  assert.doesNotMatch(newMatter, /Source files \(optional\)/);
  assert.match(newMatter, /Attach at least one source file\./);
  assert.match(newMatter, /if \(files\.length === 0\)/);
  assert.match(newMatter, /disabled=\{submitting \|\| files\.length === 0\}/);
});

test("React upload forms block oversized batches before submitting FormData", async () => {
  const newMatter = await readFile(newMatterPath, "utf8");
  const addFiles = await readFile(addFilesPath, "utf8");

  for (const source of [newMatter, addFiles]) {
    assert.match(source, /assessUploadBatchSize/);
    assert.match(source, /state\.config\?\.maxUploadBytes/);
  }
  assert.match(newMatter, /const sizeCheck = assessUploadBatchSize\(files, state\.config\?\.maxUploadBytes\)/);
  assert.match(addFiles, /const sizeCheck = assessUploadBatchSize\(collected, state\.config\?\.maxUploadBytes\)/);
});

test("React new-matter form checks overlap before creating a matter", async () => {
  const newMatter = await readFile(newMatterPath, "utf8");

  assert.match(newMatter, /hashFilesSha256IfAvailable/);
  assert.match(newMatter, /api\.checkOverlap\(\{ hashes, proposedName: cleanName \}\)/);
  assert.match(newMatter, /Possible duplicate matter/);
  assert.match(newMatter, /Continue creating new matter/);
  assert.match(newMatter, /setBypassOverlap\(true\)/);
});

test("React upload forms report browser-only duplicate-check telemetry without leaking filenames", async () => {
  const newMatter = await readFile(newMatterPath, "utf8");
  const addFiles = await readFile(addFilesPath, "utf8");
  const uploadTelemetry = await readFile(uploadTelemetryPath, "utf8");

  assert.match(newMatter, /reportUploadPrecheckUnavailable\(/);
  assert.match(addFiles, /reportUploadPrecheckUnavailable\(/);
  assert.match(uploadTelemetry, /capturePrivateBetaClientSignal/);
  assert.match(uploadTelemetry, /upload\.precheck_hash_unavailable/);
  assert.match(uploadTelemetry, /sizeBucketForFiles/);
  assert.doesNotMatch(uploadTelemetry, /relativePath|fileName|\.name\b/);
});

test("React new-matter form switches to the server-returned matter folder after create", async () => {
  const newMatter = await readFile(newMatterPath, "utf8");

  assert.match(newMatter, /const created = await api\.newMatter\(fd\)/);
  assert.match(newMatter, /const createdName = created\.folderName \|\| cleanName/);
  assert.match(newMatter, /await switchActiveMatter\(createdName,/);
  assert.match(newMatter, /onCreated\(createdName, \{ autoPrepare: true \}\)/);
});

async function importHelper() {
  const source = await readFile(helperPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled)}`);
}

async function importUploadPreflight() {
  const source = await readFile(uploadPreflightPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled)}`);
}

function fakeFileEntry(name) {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file(resolve) {
      resolve({ name, size: 1 });
    },
  };
}

function fakeDirectoryEntry(name, batches) {
  let index = 0;
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader() {
      return {
        readEntries(resolve) {
          resolve(batches[index++] || []);
        },
      };
    },
  };
}
