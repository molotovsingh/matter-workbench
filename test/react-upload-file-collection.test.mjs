import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const helperPath = new URL("../react-ui/src/lib/uploadFileCollection.ts", import.meta.url);
const uploadPreflightPath = new URL("../react-ui/src/lib/uploadBatchPreflight.ts", import.meta.url);
const newMatterPath = new URL("../react-ui/src/views/NewMatterForm.tsx", import.meta.url);
const addFilesPath = new URL("../react-ui/src/views/AddFilesForm.tsx", import.meta.url);
const uploadTelemetryPath = new URL("../react-ui/src/lib/uploadClientTelemetry.ts", import.meta.url);
const uploadRecoveryCardPath = new URL("../react-ui/src/components/upload/UploadSessionRecoveryCard.tsx", import.meta.url);

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
    { ok: true, totalBytes: 9, maxBytes: 10, totalFiles: 2, maxFiles: 5000, message: "" },
  );

  const blocked = assessUploadBatchSize([
    { relativePath: "too-large.pdf", file: { name: "too-large.pdf", size: 11 } },
  ], 10);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.totalBytes, 11);
  assert.equal(blocked.maxBytes, 10);
  assert.equal(blocked.totalFiles, 1);
  assert.equal(blocked.maxFiles, 5000);
  assert.match(blocked.message, /too large for one upload/i);
  assert.match(blocked.message, /10 B/);
});

test("React upload preflight blocks batches over the configured file limit", async () => {
  const { assessUploadBatchSize } = await importUploadPreflight();

  const blocked = assessUploadBatchSize([
    { relativePath: "one.pdf", file: { name: "one.pdf", size: 1 } },
    { relativePath: "two.pdf", file: { name: "two.pdf", size: 1 } },
    { relativePath: "three.pdf", file: { name: "three.pdf", size: 1 } },
  ], 100, 2);

  assert.equal(blocked.ok, false);
  assert.equal(blocked.totalFiles, 3);
  assert.equal(blocked.maxFiles, 2);
  assert.match(blocked.message, /too many files/i);
  assert.match(blocked.message, /2 files/);
});

test("React upload preflight describes larger private beta upload batches", async () => {
  const { assessUploadBatchSize } = await importUploadPreflight();

  const small = assessUploadBatchSize([
    { relativePath: "small.pdf", file: { name: "small.pdf", size: 2 * 1024 * 1024 } },
  ], undefined);

  assert.equal(small.ok, true);
  assert.equal(small.maxBytes, 256 * 1024 * 1024);

  const allowed = assessUploadBatchSize([
    { relativePath: "sb16.pdf", file: { name: "sb16.pdf", size: 120 * 1024 * 1024 } },
    { relativePath: "sb15.pdf", file: { name: "sb15.pdf", size: 100 * 1024 * 1024 } },
  ], undefined);

  assert.equal(allowed.ok, true);
  assert.equal(allowed.maxBytes, 256 * 1024 * 1024);
});

test("React upload preflight keeps the browser stability cap below a larger server limit", async () => {
  const { assessUploadBatchSize } = await importUploadPreflight();

  const blocked = assessUploadBatchSize([
    { relativePath: "large-1.pdf", file: { name: "large-1.pdf", size: 180 * 1024 * 1024 } },
    { relativePath: "large-2.pdf", file: { name: "large-2.pdf", size: 100 * 1024 * 1024 } },
  ], 2 * 1024 * 1024 * 1024);

  assert.equal(blocked.ok, false);
  assert.equal(blocked.maxBytes, 256 * 1024 * 1024);
  assert.match(blocked.message, /256 MB/);
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
  assert.match(newMatter, /formatSize\(totalSize\)/);
  assert.match(newMatter, /Uploading \$\{files\.length\} file\(s\) and creating the matter/);
  assert.match(addFiles, /Uploading \$\{collected\.length\} file\(s\) to this matter/);
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
  assert.match(newMatter, /const sizeCheck = assessUploadBatchSize\(files, state\.config\?\.maxUploadBytes, state\.config\?\.maxUploadFiles\)/);
  assert.match(addFiles, /const sizeCheck = assessUploadBatchSize\(collected, state\.config\?\.maxUploadBytes, state\.config\?\.maxUploadFiles\)/);
  assert.match(newMatter, /describeUploadBatchLimit\(state\.config\?\.maxUploadBytes, state\.config\?\.maxUploadFiles\)/);
  assert.match(addFiles, /describeUploadBatchLimit\(state\.config\?\.maxUploadBytes, state\.config\?\.maxUploadFiles\)/);
});

test("React new-matter form checks overlap before creating a matter", async () => {
  const newMatter = await readFile(newMatterPath, "utf8");

  assert.match(newMatter, /hashFilesSha256IfAvailable/);
  assert.match(newMatter, /api\.checkOverlap\(\{ hashes, proposedName: cleanName \}\)/);
  assert.match(newMatter, /Possible duplicate matter/);
  assert.match(newMatter, /Continue creating new matter/);
  assert.match(newMatter, /setBypassOverlap\(true\)/);
});

test("React upload forms distinguish intentional large-batch precheck skips from browser failures", async () => {
  const newMatter = await readFile(newMatterPath, "utf8");
  const addFiles = await readFile(addFilesPath, "utf8");
  const uploadTelemetry = await readFile(uploadTelemetryPath, "utf8");

  for (const source of [newMatter, addFiles]) {
    assert.match(source, /browserFileHashSkipReason/);
    assert.match(source, /reportUploadPrecheckSkippedLargeBatch\(/);
    assert.match(source, /reportUploadPrecheckUnavailable\(/);
    assert.match(source, /Duplicate precheck was skipped to keep the browser responsive; upload is continuing normally/);
  }
  assert.match(uploadTelemetry, /capturePrivateBetaClientSignal/);
  assert.match(uploadTelemetry, /upload\.precheck_skipped_large_batch/);
  assert.match(uploadTelemetry, /severity: 'info'/);
  assert.match(uploadTelemetry, /upload\.precheck_hash_unavailable/);
  assert.match(uploadTelemetry, /sizeBucketForFiles/);
  assert.doesNotMatch(uploadTelemetry, /relativePath|fileName|\.name\b/);
});

test("React large-batch precheck telemetry is informational and filename-safe", async () => {
  const calls = [];
  const { reportUploadPrecheckSkippedLargeBatch } = await importUploadTelemetry({
    capturePrivateBetaClientSignal: async (body) => {
      calls.push(body);
      return { captured: 1, sent: 0, queued: 1, failed: 0, skipped: 0 };
    },
  });

  reportUploadPrecheckSkippedLargeBatch({
    files: [
      { relativePath: "Court Cases/.DS_Store", file: { name: ".DS_Store", size: 100 * 1024 * 1024 } },
      { relativePath: "Court Cases/order.pdf", file: { name: "order.pdf", size: 100 * 1024 * 1024 } },
    ],
    matterName: "LIC matter",
    view: "add_files",
    action: "add_files",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].code, "upload.precheck_skipped_large_batch");
  assert.equal(calls[0].severity, "info");
  assert.equal(calls[0].stage, "upload_precheck");
  assert.equal(calls[0].fileCount, 2);
  assert.equal(calls[0].sizeBucket, "100_500_mb");
  assert.equal(calls[0].errorClass, "LargeBatchPolicy");
  assert.doesNotMatch(JSON.stringify(calls[0]), /Court Cases|DS_Store|order\.pdf/);
});

test("React upload forms report submit failures without leaking filenames", async () => {
  const calls = [];
  const { reportUploadSubmitFailure } = await importUploadTelemetry({
    capturePrivateBetaClientSignal: async (body) => {
      calls.push(body);
      return { captured: 1, sent: 0, queued: 1, failed: 0, skipped: 0 };
    },
  });
  const newMatter = await readFile(newMatterPath, "utf8");
  const addFiles = await readFile(addFilesPath, "utf8");

  reportUploadSubmitFailure({
    files: [
      { relativePath: "Evidence/sbi6.pdf", file: { name: "sbi6.pdf", size: 25 * 1024 * 1024 } },
      { relativePath: "Evidence/sbi5.pdf", file: { name: "sbi5.pdf", size: 25 * 1024 * 1024 } },
    ],
    matterName: "Atibir Industries v State Bank of India",
    view: "new_matter",
    action: "create_matter",
    error: { code: "upload.network_failed", message: "Failed to fetch Evidence/sbi6.pdf" },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].code, "upload.network_failed");
  assert.equal(calls[0].stage, "upload_submit");
  assert.equal(calls[0].severity, "error");
  assert.equal(calls[0].category, "upload");
  assert.equal(calls[0].fileCount, 2);
  assert.equal(calls[0].sizeBucket, "10_100_mb");
  assert.equal(calls[0].errorClass, "Object");
  assert.equal(calls[0].errorMessage, "Upload submit failed before completion.");
  assert.doesNotMatch(JSON.stringify(calls[0]), /sbi6|Evidence|Failed to fetch/);
  assert.match(newMatter, /reportUploadSubmitFailure\(/);
  assert.match(addFiles, /reportUploadSubmitFailure\(/);
});

test("React new-matter form switches to the server-returned matter folder after create", async () => {
  const newMatter = await readFile(newMatterPath, "utf8");

  assert.match(newMatter, /createMatterWithUploadSession\(/);
  assert.match(newMatter, /return api\.newMatter\(fd\)/);
  assert.match(newMatter, /const createdName = created\.folderName \|\| cleanName/);
  assert.match(newMatter, /upload complete:/);
  assert.match(newMatter, /automatic preparation is starting; follow progress in Activity/);
  assert.match(newMatter, /await switchActiveMatter\(createdName,/);
  assert.match(newMatter, /onCreated\(createdName, \{ autoPrepare: true \}\)/);
});


test("React upload forms surface resumable durable upload sessions", async () => {
  const newMatter = await readFile(newMatterPath, "utf8");
  const addFiles = await readFile(addFilesPath, "utf8");
  const recoveryCard = await readFile(uploadRecoveryCardPath, "utf8");

  for (const source of [newMatter, addFiles]) {
    assert.match(source, /findLatestUploadSessionDraft/);
    assert.match(source, /findMatchingUploadSessionDraft/);
    assert.match(source, /UploadSessionRecoveryCard/);
    assert.match(source, /resumeDraft/);
  }
  assert.match(recoveryCard, /selectedFilesMatchUploadSessionDraft/);
  assert.match(recoveryCard, /Unfinished upload session found/);
  assert.match(recoveryCard, /Forget saved upload/);
  assert.match(recoveryCard, /Use saved details/);
  assert.match(newMatter, /onUseSavedDetails=\{handleUseRecoverableUpload\}/);
  assert.match(newMatter, /resuming durable upload session/);
  assert.match(addFiles, /resuming durable upload session/);
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

async function importUploadTelemetry(api) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mwb-upload-telemetry-"));
  const apiModulePath = path.join(dir, "client.mjs");
  const telemetryModulePath = path.join(dir, "uploadClientTelemetry.mjs");
  await writeFile(apiModulePath, `export const api = globalThis.__mwbUploadTelemetryApi;`);
  const source = await readFile(uploadTelemetryPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  }).outputText.replace("from '../api/client';", `from '${apiModulePath}';`);
  await writeFile(telemetryModulePath, transpiled);
  globalThis.__mwbUploadTelemetryApi = api;
  try {
    return await import(`${telemetryModulePath}?t=${Date.now()}-${Math.random()}`);
  } finally {
    delete globalThis.__mwbUploadTelemetryApi;
    await rm(dir, { recursive: true, force: true });
  }
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
