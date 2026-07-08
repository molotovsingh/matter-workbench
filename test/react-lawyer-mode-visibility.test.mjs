import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const lawyerModePath = new URL("../react-ui/src/lib/lawyerMode.ts", import.meta.url);
const sidebarPath = new URL("../react-ui/src/components/layout/Sidebar.tsx", import.meta.url);
const titleBarPath = new URL("../react-ui/src/components/layout/TitleBar.tsx", import.meta.url);
const workspaceTreePath = new URL("../react-ui/src/components/workspace/WorkspaceTree.tsx", import.meta.url);

async function importLawyerModeModule() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "react-lawyer-mode-test-"));
  const source = await readFile(lawyerModePath, "utf8");
  await writeFile(path.join(tempDir, "lawyerMode.mjs"), ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
  }).outputText);
  return import(`${pathToFileURL(path.join(tempDir, "lawyerMode.mjs")).href}?t=${Date.now()}`);
}

test("React lawyer mode helper allows operator surfaces in local mode and for superusers", async () => {
  const { canSeeOperatorSurface } = await importLawyerModeModule();

  assert.equal(canSeeOperatorSurface(false, null), true);
  assert.equal(canSeeOperatorSurface(true, { username: "aks", role: "superuser" }), true);
  assert.equal(canSeeOperatorSurface(true, { username: "lawyer@example.test", role: "tester" }), false);
  assert.equal(canSeeOperatorSurface(true, { username: "operator@example.test", role: "operator" }), false);
  assert.equal(canSeeOperatorSurface(true, null), false);
});

test("React lawyer mode helper filters generated internals but keeps client evidence", async () => {
  const { filterWorkspaceFilesForOperatorVisibility } = await importLawyerModeModule();
  const files = [
    { name: "matter.json", path: "matter.json", type: "file" },
    {
      name: "Source Record",
      path: "10_Library",
      type: "folder",
      children: [
        { name: "Case Timeline.md", path: "10_Library/Case Timeline.md", type: "file" },
        { name: "Case Timeline.json", path: "10_Library/Case Timeline.json", type: "file" },
        { name: "Source Index.json", path: "10_Library/Source Index.json", type: "file" },
      ],
    },
    {
      name: "Original Documents",
      path: "00_Inbox",
      type: "folder",
      children: [
        { name: "client-ledger.csv", path: "00_Inbox/Intake 01 - Initial/Originals/client-ledger.csv", type: "file" },
      ],
    },
  ];

  assert.deepEqual(flattenFilePaths(filterWorkspaceFilesForOperatorVisibility(files, true, { username: "lawyer@example.test", role: "tester" })), [
    "10_Library",
    "10_Library/Case Timeline.md",
    "00_Inbox",
    "00_Inbox/Intake 01 - Initial/Originals/client-ledger.csv",
  ]);

  assert.equal(filterWorkspaceFilesForOperatorVisibility(files, false, null), files);
  assert.equal(filterWorkspaceFilesForOperatorVisibility(files, true, { username: "aks", role: "superuser" }), files);
});

test("React chrome gates technical controls with lawyer mode helpers", async () => {
  const sidebar = await readFile(sidebarPath, "utf8");
  const titleBar = await readFile(titleBarPath, "utf8");
  const workspaceTree = await readFile(workspaceTreePath, "utf8");

  assert.match(sidebar, /canSeeOperatorSurface\(state\.authEnabled, state\.authUser\)/);
  assert.match(sidebar, /Recent work/);
  assert.match(sidebar, /tab\.operatorOnly/);
  assert.match(sidebar, /Show technical: operator only/);

  assert.match(titleBar, /const showOperatorChrome = canSeeOperatorSurface\(state\.authEnabled, state\.authUser\)/);
  assert.match(titleBar, /showOperatorChrome && \(\s*<span className="workspace-mode">/);

  assert.match(workspaceTree, /filterWorkspaceFilesForOperatorVisibility\(workspace\.children, state\.authEnabled, state\.authUser\)/);
  assert.match(workspaceTree, /showOperatorChrome && \(/);
  assert.match(workspaceTree, /Could not open that file/);
});

function flattenFilePaths(files) {
  const paths = [];
  for (const file of files || []) {
    paths.push(file.path);
    if (file.children) paths.push(...flattenFilePaths(file.children));
  }
  return paths;
}
