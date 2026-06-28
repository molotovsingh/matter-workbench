import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidebarPath = new URL("../react-ui/src/components/layout/Sidebar.tsx", import.meta.url);
const apiClientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);
const stylesPath = new URL("../react-ui/src/styles/global.css", import.meta.url);

test("React archive confirmation captures an optional non-destructive archive reason", async () => {
  const [sidebar, apiClient, styles] = await Promise.all([
    readFile(sidebarPath, "utf8"),
    readFile(apiClientPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);

  assert.match(sidebar, /Reason for archive \(optional\)/);
  assert.match(sidebar, /maxLength=\{500\}/);
  assert.match(sidebar, /api\.archiveMatter\(activeMatter\.name, \{ reason: archiveReason \}\)/);
  assert.match(sidebar, /No source files, generated artifacts, file IDs, or history will be deleted/);
  assert.match(apiClient, /archiveMatter: \(name: string, opts: \{ reason\?: string \} = \{\}\)/);
  assert.match(apiClient, /reason: opts\.reason \|\| ''/);
  assert.match(styles, /archive-reason-field/);
  assert.doesNotMatch(sidebar, /unarchive/i);
});
