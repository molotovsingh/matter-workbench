import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const telemetryPath = new URL("../react-ui/src/lib/copilotResearchTelemetry.ts", import.meta.url);
const appPath = new URL("../react-ui/src/App.tsx", import.meta.url);

test("Research telemetry reports failures and answer outcomes to client signals", async () => {
  const calls = [];
  const telemetry = await importTelemetry({ calls });

  telemetry.reportResearchFailure({ matterName: "Sunrise", error: { code: "copilot_research.provider_timeout" } });
  telemetry.reportResearchAnswer({ matterName: "Sunrise", answerStatus: "partial", publicSourceCount: 4 });
  await Promise.resolve();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].code, "copilot_research.provider_timeout");
  assert.equal(calls[0].category, "copilot_research");
  assert.equal(calls[0].severity, "error");
  assert.equal(calls[0].view, "command_panel");
  assert.equal(calls[0].action, "research");
  assert.equal(calls[0].matterName, "Sunrise");
  assert.equal(calls[1].code, "copilot_research.answer_returned");
  assert.equal(calls[1].severity, "warning");
  assert.equal(calls[1].fileCount, 4);
});

test("App wires Research telemetry on success and failure", async () => {
  const source = await readFile(appPath, "utf8");

  assert.match(source, /reportResearchAnswer/);
  assert.match(source, /reportResearchFailure/);
  assert.match(source, /publicSourceCount: \(answer\.public_sources \|\| \[\]\)\.length/);
});

async function importTelemetry({ calls }) {
  let source = await readFile(telemetryPath, "utf8");
  source = source.replace(/import \{ api \} from '[^']+';\n/, "const api = globalThis.__TEST_API__;\n");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  globalThis.__TEST_API__ = {
    capturePrivateBetaClientSignal: async (body) => {
      calls.push(body);
      return { captured: 1 };
    },
  };
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
  return import(moduleUrl);
}
