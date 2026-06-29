import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const reactSecretRedactionPath = new URL("../react-ui/src/lib/secretRedaction.ts", import.meta.url);
const reactNativeCommandsPath = new URL("../react-ui/src/lib/nativeCommands.ts", import.meta.url);
const reactNativeCommandAliasesPath = new URL("../react-ui/src/lib/nativeCommandAliases.ts", import.meta.url);
const reactPresentationLabelsPath = new URL("../react-ui/src/lib/presentationLabels.ts", import.meta.url);
const reactWorkspaceLabelsPath = new URL("../react-ui/src/lib/workspaceLabels.ts", import.meta.url);
const reactActivityLogPath = new URL("../react-ui/src/lib/activityLog.ts", import.meta.url);
const reactCommandPanelPath = new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url);
const reactCopilotQuickSwitchPath = new URL("../react-ui/src/components/command/CopilotQuickSwitch.tsx", import.meta.url);
const reactCopilotQuickSwitchHookPath = new URL("../react-ui/src/hooks/useCopilotQuickSwitch.ts", import.meta.url);
const reactMainContentPath = new URL("../react-ui/src/components/layout/MainContent.tsx", import.meta.url);
const reactActivityPagePath = new URL("../react-ui/src/views/ActivityPage.tsx", import.meta.url);

let reactActivityLogModulePromise = null;

async function importReactActivityLogModule() {
  if (reactActivityLogModulePromise) return reactActivityLogModulePromise;

  reactActivityLogModulePromise = (async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "mwb-react-activity-log-"));
    const secretFile = path.join(tempDir, "secretRedaction.mjs");
    const nativeCommandsFile = path.join(tempDir, "nativeCommands.mjs");
    const nativeCommandAliasesFile = path.join(tempDir, "nativeCommandAliases.mjs");
    const presentationFile = path.join(tempDir, "presentationLabels.mjs");
    const workspaceLabelsFile = path.join(tempDir, "workspaceLabels.mjs");
    const activityFile = path.join(tempDir, "activityLog.mjs");

    await writeFile(secretFile, transpile(await readFile(reactSecretRedactionPath, "utf8")));
    await writeFile(nativeCommandAliasesFile, transpile(await readFile(reactNativeCommandAliasesPath, "utf8")));
    const nativeCommandsSource = (await readFile(reactNativeCommandsPath, "utf8"))
      .replace("'./nativeCommandAliases'", "'./nativeCommandAliases.mjs'");
    await writeFile(nativeCommandsFile, transpile(nativeCommandsSource));
    await writeFile(workspaceLabelsFile, transpile(await readFile(reactWorkspaceLabelsPath, "utf8")));
    const presentationSource = (await readFile(reactPresentationLabelsPath, "utf8"))
      .replace("'./workspaceLabels'", "'./workspaceLabels.mjs'");
    await writeFile(presentationFile, transpile(presentationSource));
    const source = (await readFile(reactActivityLogPath, "utf8"))
      .replace("'./secretRedaction'", "'./secretRedaction.mjs'")
      .replace("'./nativeCommands'", "'./nativeCommands.mjs'")
      .replace("'./presentationLabels'", "'./presentationLabels.mjs'");
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
    "[prepare] running: /create_listofdates",
    "[landing] loaded /Users/aksingh/matters-matter-workbench",
    "[file] opened 10_Library/List of Dates.md",
    "[source-index] OPENAI_API_KEY=sk-strip-secret",
  ], () => "18:57:34");

  assert.deepEqual(latestCompactActivityRows(lines, 4), [
    { time: "18:57", message: "running: Build Case Timeline" },
    { time: "18:57", message: "loaded /Users/aksingh/matters-matter-workbench" },
    { time: "18:57", message: "opened Case Timeline" },
    { time: "18:57", message: "OPENAI_API_KEY=[redacted-secret]" },
  ]);
});

test("React command panel reads the shared activity stream, not a local-only strip", async () => {
  const source = await readFile(reactCommandPanelPath, "utf8");

  assert.match(source, /latestCompactActivityRows\(state\.activityLines\)/);
  assert.doesNotMatch(source, /setActivityLog|activityLog,\s*setActivityLog/);
});

test("React shell keeps activity in the command panel and Activity page only", async () => {
  const mainContent = await readFile(reactMainContentPath, "utf8");
  const activityPage = await readFile(reactActivityPagePath, "utf8");

  assert.doesNotMatch(mainContent, /bottom-panel|terminal-output|terminalRef/);
  assert.match(activityPage, /activity-system-log/);
  assert.match(activityPage, /System Log/);
});

test("React command panel exposes the tested model switcher only to operators", async () => {
  const commandPanelSource = await readFile(reactCommandPanelPath, "utf8");
  const switchSource = await readFile(reactCopilotQuickSwitchPath, "utf8");
  const hookSource = await readFile(reactCopilotQuickSwitchHookPath, "utf8");

  assert.match(commandPanelSource, /canManageCopilotSettings && <CopilotQuickSwitch/);
  assert.match(switchSource, /aria-label="Copilot strength"/);
  assert.match(switchSource, /switcher\.presets\.map/);
  assert.match(hookSource, /api\.saveAiSettings\(\{\s*copilotProvider/s);
  assert.match(hookSource, /setPresets\(settings\.copilotModelPresets \|\| \[\]\)/);
  assert.match(hookSource, /Testing \$\{nextPreset\.shortLabel\}/);
  assert.match(hookSource, /Switch failed\. Still using/);
  assert.doesNotMatch(switchSource, /disabled=\{!canManageCopilotSettings \|\| switching\}/);
});
