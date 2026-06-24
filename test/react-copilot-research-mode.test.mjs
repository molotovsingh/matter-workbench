import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../react-ui/src/App.tsx", import.meta.url);
const apiPath = new URL("../react-ui/src/api/client.ts", import.meta.url);
const answerPath = new URL("../react-ui/src/lib/matterCopilotAnswer.ts", import.meta.url);
const typesPath = new URL("../react-ui/src/types/index.ts", import.meta.url);

test("React command panel exposes Skill Ask Research modes", async () => {
  const source = await readFile(new URL("../react-ui/src/components/command/CommandPanel.tsx", import.meta.url), "utf8");

  assert.match(source, /type CommandMode = 'skill' \| 'ask' \| 'research'/);
  assert.match(source, /\[\'skill\', \'ask\', \'research\'\] as CommandMode\[\]/);
  assert.match(source, /commandForMode\(commandMode, cmd\)/);
  assert.match(source, /mode === 'research' && !canUseResearch/);
  assert.match(source, /Research/);
});

test("React Copilot Research command routes directly before ask and skill routing", async () => {
  const source = await readFile(appPath, "utf8");

  assert.match(source, /parseResearchCommand/);
  assert.match(source, /const researchQuestion = parseResearchCommand\(cmd\)/);
  assert.match(source, /await researchMatterQuestion\(researchQuestion\)/);
  assert.match(source, /const askQuestion = parseAskCommand\(cmd\)/);
  assert.ok(source.indexOf("const researchQuestion = parseResearchCommand(cmd)") < source.indexOf("const askQuestion = parseAskCommand(cmd)"));
  assert.ok(source.indexOf("const researchQuestion = parseResearchCommand(cmd)") < source.indexOf("const nativeResolution = resolveNativeCommand(lower)"));
});

test("React API client exposes Copilot Research contract", async () => {
  const api = await readFile(apiPath, "utf8");
  const types = await readFile(typesPath, "utf8");

  assert.match(api, /MatterCopilotResearchAnswer/);
  assert.match(api, /researchMatterQuestion: \(body: \{ question: string; matterName\?: string \}\) =>/);
  assert.match(api, /postJson<MatterCopilotResearchAnswer>\('\/api\/matter-copilot\/research', body\)/);
  assert.match(types, /interface MatterCopilotPublicSource/);
  assert.match(types, /interface MatterCopilotResearchAnswer/);
});

test("React Research answer rendering separates public sources and verification caveat", async () => {
  const source = await readFile(answerPath, "utf8");

  assert.match(source, /parseResearchCommand/);
  assert.match(source, /formatMatterCopilotResearchAnswer/);
  assert.match(source, /Research answer from public sources/);
  assert.match(source, /Public sources:/);
  assert.match(source, /Matter sources:/);
  assert.match(source, /\$\{id\} — \$\{labelText\}/);
  assert.match(source, /Partial research answer from public sources/);
  assert.match(source, /Verify authorities before relying or filing/);
});
