import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

import { redactSensitiveText as redactSharedSensitiveText } from "../shared/secret-redaction.mjs";

const reactSecretRedactionPath = new URL("../react-ui/src/lib/secretRedaction.ts", import.meta.url);

test("React secret redaction mirrors shared sensitive-text policy", async () => {
  const source = await readFile(reactSecretRedactionPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled)}`;
  const { redactSensitiveText: redactReactSensitiveText } = await import(moduleUrl);

  const inputs = [
    "OPENAI_API_KEY=sk-openai-secret",
    "OPENROUTER_API_KEY='sk-router-secret'",
    "MISTRAL_API_KEY=\"sk-mistral-secret\"",
    "Authorization: Bearer sk-bearer-secret",
    '{"apiKey":"sk-json-secret","nested":"safe"}',
    "{ api_key: sk-plain-secret, x-api-key: sk-header-secret }",
    "Matter name contains sk-matter-secret and should be copied safely",
    "connect failed: postgres://operator:fixture-pass@db.internal:5432/mothership",
    "postgresql://operator:fixture-pass@db.internal:5432/mothership",
    "sync rejected mwb_ing_fixture-ingestion-token",
    "MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN=fixture-sync-token",
    "my_secret=lowercase-fixture-secret",
    "login failed password: fixture-pass token=fixture-token",
    "Gemini rejected google key AIzaSyFixtureGoogleKeyValue",
  ];

  for (const input of inputs) {
    assert.equal(redactReactSensitiveText(input), redactSharedSensitiveText(input), input);
    assert.doesNotMatch(redactReactSensitiveText(input), /sk-[A-Za-z0-9_-]+|AIza[0-9A-Za-z_-]+/);
  }
});
