import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const reactFilePreviewPath = new URL("../react-ui/src/lib/filePreview.ts", import.meta.url);
const reactActivityPagePath = new URL("../react-ui/src/views/ActivityPage.tsx", import.meta.url);

async function importReactFilePreviewModule() {
  const source = await readFile(reactFilePreviewPath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(output)}`);
}

test("React file preview helper loads text content before rendering preview", async () => {
  const { filePreviewTitle, loadTextFilePreview } = await importReactFilePreviewModule();
  const preview = await loadTextFilePreview("20_Workshop/Party and Officer Map.md", async (path) => {
    assert.equal(path, "20_Workshop/Party and Officer Map.md");
    return { content: "# Party and Officer Map", ext: "md" };
  });

  assert.deepEqual(preview, {
    path: "20_Workshop/Party and Officer Map.md",
    type: "text",
    content: "# Party and Officer Map",
    ext: "md",
  });
  assert.equal(filePreviewTitle("20_Workshop/Party and Officer Map.md"), "Party and Officer Map.md");
});

test("React Activity output action fetches preview content before opening file view", async () => {
  const source = await readFile(reactActivityPagePath, "utf8");
  assert.match(source, /const preview = await loadTextFilePreview\(outputPath,\s*api\.getFile\)/);
  assert.match(source, /if \(activeMatterNameRef\.current !== matterName\) return;\s*dispatch\(\{ type: 'SET_ACTIVE_FILE'/);
  assert.match(source, /payload: preview/);
  assert.doesNotMatch(source, /SET_FILE_PREVIEW', payload: \{ path: outputPath, type: 'text' \}/);
});
