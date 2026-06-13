import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const helperPath = new URL("../react-ui/src/lib/uploadFileCollection.ts", import.meta.url);
const newMatterPath = new URL("../react-ui/src/views/NewMatterForm.tsx", import.meta.url);
const addFilesPath = new URL("../react-ui/src/views/AddFilesForm.tsx", import.meta.url);

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

test("React new-matter and add-files forms share folder-aware upload collection helpers", async () => {
  const newMatter = await readFile(newMatterPath, "utf8");
  const addFiles = await readFile(addFilesPath, "utf8");

  for (const source of [newMatter, addFiles]) {
    assert.match(source, /collectDroppedEntries/);
    assert.match(source, /collectFilesFromFileList/);
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
