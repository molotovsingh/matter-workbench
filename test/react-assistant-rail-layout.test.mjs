import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainContentPath = new URL("../react-ui/src/components/layout/MainContent.tsx", import.meta.url);
const commandPanelPath = new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url);
const cssPath = new URL("../react-ui/src/styles/global.css", import.meta.url);

test("Matter Assistant rail is resizable with browser-local width", async () => {
  const source = await readFile(mainContentPath, "utf8");
  const css = await readFile(cssPath, "utf8");

  assert.match(source, /ASSISTANT_WIDTH_STORAGE_KEY = 'mwb\.matterAssistant\.width'/);
  assert.match(source, /--assistant-width/);
  assert.match(source, /className="assistant-rail-resizer"/);
  assert.match(source, /aria-label="Resize Matter Assistant"/);
  assert.match(source, /onPointerDown=\{startAssistantResize\}/);
  assert.match(source, /onDoubleClick=\{resetAssistantWidth\}/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(320px, var\(--assistant-width, 380px\)\)/);
  assert.match(css, /\.assistant-rail-resizer/);
  assert.match(css, /body\.assistant-resizing/);
});

test("app shell renders dismissible toast notifications", async () => {
  const source = await readFile(mainContentPath, "utf8");
  const css = await readFile(cssPath, "utf8");

  assert.match(source, /state\.toast/);
  assert.match(source, /DISMISS_TOAST/);
  assert.match(source, /window\.setTimeout/);
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /className=\{`app-toast \$\{toast\.tone\}`\}/);
  assert.match(css, /\.app-toast/);
  assert.match(css, /\.app-toast\.success/);
});

test("Matter Assistant header stays compact", async () => {
  const source = await readFile(commandPanelPath, "utf8");

  assert.match(source, /className="command-panel-title">Matter Assistant/);
  assert.match(source, /Ask, Research, or Skill\./);
  assert.match(source, />\s*New\s*</);
  assert.doesNotMatch(source, /What do you need\?/);
});
