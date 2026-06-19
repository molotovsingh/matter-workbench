import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../react-ui/src/App.tsx", import.meta.url);
const readinessGatePath = new URL("../react-ui/src/components/auth/PrivateBetaReadinessGate.tsx", import.meta.url);
const readinessHookPath = new URL("../react-ui/src/hooks/useUserReadinessGate.ts", import.meta.url);
const clientPath = new URL("../react-ui/src/api/client.ts", import.meta.url);
const typesPath = new URL("../react-ui/src/types/index.ts", import.meta.url);

test("React app shows a neutral post-login readiness gate", async () => {
  const app = await readFile(appPath, "utf8");
  const gate = await readFile(readinessGatePath, "utf8");
  const hook = await readFile(readinessHookPath, "utf8");
  const client = await readFile(clientPath, "utf8");
  const types = await readFile(typesPath, "utf8");

  assert.match(client, /getUserReadiness: \(\) => getJson<UserReadinessReport>\('\/api\/user-readiness'\)/);
  assert.match(types, /export interface UserReadinessReport/);
  assert.match(app, /useUserReadinessGate/);
  assert.match(app, /PrivateBetaReadinessGate/);
  assert.match(app, /authStatus\.authenticated && !readinessGate\.dismissed/);
  assert.match(app, /readiness-session-banner/);
  assert.match(gate, /Preparing your workspace/);
  assert.match(gate, /Checking \{currentStep\} of \{total\}/);
  assert.match(hook, /Secure session/);
  assert.match(hook, /Workspace access/);
  assert.match(hook, /Matter library/);
  assert.match(hook, /Document services/);
  assert.match(hook, /Assistant readiness/);
  assert.doesNotMatch(`${app}\n${gate}\n${hook}`, /OpenRouter|OpenAI|GPT|quota|billing|credits/);
});
