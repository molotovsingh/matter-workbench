import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const activeMatterPath = new URL("../react-ui/src/lib/activeMatter.ts", import.meta.url);

test("activeMatterFromWorkspace keeps the API-safe folder name separate from lawyer caption", async () => {
  const { activeMatterFromWorkspace } = await importActiveMatterHelper();

  const activeMatter = activeMatterFromWorkspace({
    folderName: "National Insurance Co. Ltd v M - s Sarkar Fertilizers",
    inputLabel: "DB workspace",
    metadata: {
      matterName: "National Insurance Co. Ltd v M/s Sarkar Fertilizers",
      clientName: "M/s Sarkar Fertilizers",
    },
    tree: { name: "root", type: "directory", children: [] },
    fileCount: 3,
    directoryCount: 2,
  }, "National Insurance Co. Ltd v M - s Sarkar Fertilizers");

  assert.equal(activeMatter.name, "National Insurance Co. Ltd v M - s Sarkar Fertilizers");
  assert.equal(activeMatter.folderName, "National Insurance Co. Ltd v M - s Sarkar Fertilizers");
  assert.equal(activeMatter.metadata.matterName, "National Insurance Co. Ltd v M/s Sarkar Fertilizers");
  assert.equal(activeMatter.workspace.adapted.name, "root");
});

async function importActiveMatterHelper() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mwb-active-matter-"));
  const apiModulePath = path.join(dir, "client.mjs");
  const helperModulePath = path.join(dir, "activeMatter.mjs");
  await writeFile(apiModulePath, "export function adaptTree(tree) { return { adapted: tree }; }\n");
  const source = await readFile(activeMatterPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  }).outputText.replace("from '../api/client';", `from '${apiModulePath}';`);
  await writeFile(helperModulePath, transpiled);
  try {
    return await import(`${helperModulePath}?t=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
