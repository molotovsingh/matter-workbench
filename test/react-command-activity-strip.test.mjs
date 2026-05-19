import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const reactSecretRedactionPath = new URL("../react-ui/src/lib/secretRedaction.ts", import.meta.url);
const reactActivityLogPath = new URL("../react-ui/src/lib/activityLog.ts", import.meta.url);
const reactCommandPanelPath = new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url);

let reactActivityLogModulePromise = null;

async function importReactActivityLogModule() {
  if (reactActivityLogModulePromise) return reactActivityLogModulePromise;

  reactActivityLogModulePromise = (async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "mwb-react-activity-log-"));
    const secretFile = path.join(tempDir, "secretRedaction.mjs");
    const activityFile = path.join(tempDir, "activityLog.mjs");

    await writeFile(secretFile, transpile(await readFile(reactSecretRedactionPath, "utf8")));
    const source = (await readFile(reactActivityLogPath, "utf8"))
      .replace("'./secretRedaction'", "'./secretRedaction.mjs'");
    await writeFile(activityFile, transpile(source));

    return import(pathToFileURL(activityFile).href);
  })();

  return reactActivityLogModulePromise;
}

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

test("React compact command activity mirrors terminal-style status lines", async () => {
  const { stampActivityLines, latestCompactActivityRows } = await importReactActivityLogModule();

  const lines = stampActivityLines([
    "[one] first",
    "[ai-command] new skill -> matter status",
    "[source-index] OPENAI_API_KEY=sk-strip-secret",
  ], () => "18:57:34");

  assert.deepEqual(latestCompactActivityRows(lines, 2), [
    { time: "18:57", message: "new skill → matter status" },
    { time: "18:57", message: "OPENAI_API_KEY=[redacted-secret]" },
  ]);
});

test("React command panel reads the shared activity stream, not a local-only strip", async () => {
  const source = await readFile(reactCommandPanelPath, "utf8");

  assert.match(source, /latestCompactActivityRows\(state\.activityLines\)/);
  assert.doesNotMatch(source, /setActivityLog|activityLog,\s*setActivityLog/);
});
