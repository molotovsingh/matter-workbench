import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../react-ui/src/App.tsx", import.meta.url);
const commandPanelPath = new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url);
const cssPath = new URL("../react-ui/src/styles/global.css", import.meta.url);

test("React keeps a visible in-session Copilot thread without durable storage", async () => {
  const app = await readFile(appPath, "utf8");
  const panel = await readFile(commandPanelPath, "utf8");
  const css = await readFile(cssPath, "utf8");

  assert.match(app, /interface CopilotThreadTurn/);
  assert.match(app, /useState<CopilotThreadTurn\[\]>\(\[\]\)/);
  assert.match(app, /appendCopilotThreadTurn\(\{ role: 'user', mode: 'ask'/);
  assert.match(app, /appendCopilotThreadTurn\(\{ role: 'assistant', mode: 'ask'/);
  assert.match(app, /appendCopilotThreadTurn\(\{ role: 'user', mode: 'research'/);
  assert.match(app, /appendCopilotThreadTurn\(\{ role: 'assistant', mode: 'research'/);
  assert.match(app, /setCopilotThread\(\[\]\)/);
  assert.match(panel, /copilotThread\?: CopilotThreadTurn\[\]/);
  assert.match(panel, /aria-label="Copilot conversation"/);
  assert.match(panel, /copilotThread\.slice\(-6\)/);
  assert.match(panel, /onClearCopilotThread\?\.\(\)/);
  assert.match(css, /\.copilot-thread\s*\{/);
});
