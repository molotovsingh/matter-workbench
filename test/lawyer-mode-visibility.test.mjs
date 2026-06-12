import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkbenchServer } from "../server.mjs";
import {
  filterWorkspaceTreeForOperatorVisibility,
  isOperatorOnlyWorkspacePath,
} from "../services/workspace-path-policy.mjs";

test("workspace path policy keeps generated internals operator-only without hiding client source files", () => {
  assert.equal(isOperatorOnlyWorkspacePath("matter.json"), true);
  assert.equal(isOperatorOnlyWorkspacePath("00_Inbox/Intake 01 - Initial/File Register.csv"), true);
  assert.equal(isOperatorOnlyWorkspacePath("00_Inbox/Intake 01 - Initial/Extraction Log.csv"), true);
  assert.equal(isOperatorOnlyWorkspacePath("10_Library/Source Index.json"), true);
  assert.equal(isOperatorOnlyWorkspacePath("10_Library/List of Dates.json"), true);
  assert.equal(isOperatorOnlyWorkspacePath("20_Workshop/The Story.json"), true);

  assert.equal(isOperatorOnlyWorkspacePath("10_Library/List of Dates.md"), false);
  assert.equal(isOperatorOnlyWorkspacePath("00_Inbox/Intake 01 - Initial/Originals/client-ledger.csv"), false);
  assert.equal(isOperatorOnlyWorkspacePath("00_Inbox/Intake 01 - Initial/Originals/client-data.json"), false);
});

test("workspace tree filter removes empty technical branches for lawyer users", () => {
  const tree = {
    name: "Matter",
    kind: "directory",
    path: "",
    children: [
      { name: "matter.json", kind: "file", path: "matter.json" },
      {
        name: "10_Library",
        kind: "directory",
        path: "10_Library",
        children: [
          { name: "List of Dates.md", kind: "file", path: "10_Library/List of Dates.md" },
          { name: "List of Dates.json", kind: "file", path: "10_Library/List of Dates.json" },
          { name: "Source Index.json", kind: "file", path: "10_Library/Source Index.json" },
        ],
      },
      {
        name: "20_Workshop",
        kind: "directory",
        path: "20_Workshop",
        children: [
          { name: "The Story.md", kind: "file", path: "20_Workshop/The Story.md" },
          { name: "The Story.json", kind: "file", path: "20_Workshop/The Story.json" },
        ],
      },
      {
        name: "00_Inbox",
        kind: "directory",
        path: "00_Inbox",
        children: [
          { name: "client-ledger.csv", kind: "file", path: "00_Inbox/Intake 01 - Initial/Originals/client-ledger.csv" },
        ],
      },
      {
        name: "99_Debug",
        kind: "directory",
        path: "99_Debug",
        children: [
          { name: "trace.log", kind: "file", path: "99_Debug/trace.log" },
        ],
      },
    ],
  };

  const filtered = filterWorkspaceTreeForOperatorVisibility(tree, { canSeeOperatorFiles: false });
  const paths = flattenTreePaths(filtered);

  assert.deepEqual(paths, [
    "10_Library",
    "10_Library/List of Dates.md",
    "20_Workshop",
    "20_Workshop/The Story.md",
    "00_Inbox",
    "00_Inbox/Intake 01 - Initial/Originals/client-ledger.csv",
  ]);

  assert.equal(filterWorkspaceTreeForOperatorVisibility(tree, { canSeeOperatorFiles: true }), tree);
});

test("private beta file preview blocks operator-only files for tester accounts", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-lawyer-mode-preview-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Guard Matter");
  await mkdir(path.join(matterRoot, "10_Library"), { recursive: true });
  await writeFile(path.join(matterRoot, "matter.json"), JSON.stringify({ matterName: "Guard Matter" }));
  await writeFile(path.join(matterRoot, "10_Library", "Source Index.json"), "{}\n");
  await writeFile(path.join(matterRoot, "10_Library", "List of Dates.md"), "# List of Dates\n");

  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    privateBetaAuthService: {
      requireAuth: () => true,
      status: () => ({ enabled: true, authenticated: true, user: { username: "tester@example.test", role: "tester" } }),
      isAuthenticated: () => true,
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const workspace = await fetch(`${baseUrl}/api/workspace?matter=Guard%20Matter`);
    assert.equal(workspace.status, 200);
    assert.deepEqual(flattenTreePaths((await workspace.json()).tree), [
      "10_Library",
      "10_Library/List of Dates.md",
    ]);

    const blocked = await fetch(`${baseUrl}/api/file?matter=Guard%20Matter&path=matter.json`);
    assert.equal(blocked.status, 403);
    assert.match((await blocked.json()).error, /not available to this account/i);

    const allowed = await fetch(`${baseUrl}/api/file?matter=Guard%20Matter&path=10_Library/List%20of%20Dates.md`);
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).content, "# List of Dates\n");
  } finally {
    app.server.close();
  }
});

function flattenTreePaths(node) {
  const paths = [];
  for (const child of node.children || []) {
    paths.push(child.path);
    if (child.children) paths.push(...flattenTreePaths(child));
  }
  return paths;
}
