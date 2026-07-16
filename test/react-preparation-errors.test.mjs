import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const preparationErrorsPath = new URL("../react-ui/src/lib/preparationErrors.ts", import.meta.url);
const secretRedactionPath = new URL("../react-ui/src/lib/secretRedaction.ts", import.meta.url);

test("preparation errors hide raw HTML gateway failures from lawyer-facing progress", async () => {
  const { formatVisiblePreparationError } = await importPreparationErrors();
  const html = `<!doctype html>
<html>
<head><title>504 Gateway Time-out</title></head>
<body><center><h1>504 Gateway Time-out</h1></center><hr><center>nginx/1.24.0 (Ubuntu)</center></body>
</html>`;

  const message = formatVisiblePreparationError(new Error(html), { id: "extract", slash: "/extract" });

  assert.match(message, /Reading documents took too long/i);
  assert.doesNotMatch(message, /<html|<head|<title|nginx|504|Gateway/i);
});

test("preparation status errors replace raw fetch failures with reconnecting guidance", async () => {
  const {
    formatPreparationStatusError,
    isTransientPreparationStatusError,
    PREPARATION_STATUS_RECONNECT_MESSAGE,
  } = await importPreparationErrors();
  const networkError = Object.assign(new Error("Failed to fetch"), {
    code: "api.network_failed",
    statusCode: 0,
  });

  assert.equal(isTransientPreparationStatusError(networkError), true);
  assert.equal(formatPreparationStatusError(networkError), PREPARATION_STATUS_RECONNECT_MESSAGE);
  assert.doesNotMatch(formatPreparationStatusError(networkError), /Failed to fetch/i);
  assert.equal(isTransientPreparationStatusError({ statusCode: 503, message: "Unavailable" }), true);
  assert.equal(isTransientPreparationStatusError({ statusCode: 409, code: "matter.conflict" }), false);
  assert.match(
    formatPreparationStatusError({ statusCode: 409, code: "matter.conflict", message: "Matter changed" }),
    /Preparation status is temporarily unavailable: Matter changed/,
  );
});

test("preparation errors redact secrets while preserving useful plain errors", async () => {
  const { formatVisiblePreparationError } = await importPreparationErrors();

  const message = formatVisiblePreparationError(
    new Error("Provider failed with OPENAI_API_KEY=sk-hidden token=abc123 postgres://operator:dbpass@db:5432/mwb mwb_ing_hidden AIzaSyFixtureGoogleKeyValue"),
  );

  assert.match(message, /Provider failed/i);
  assert.match(message, /OPENAI_API_KEY=\[redacted-secret\]/);
  assert.match(message, /token=\[redacted-secret\]/);
  assert.match(message, /postgres:\/\/operator:\*\*\*@db:5432\/mwb/);
  assert.match(message, /mwb_ing_\[redacted-secret\]/);
  assert.doesNotMatch(message, /sk-hidden|abc123|dbpass|mwb_ing_hidden|AIzaSyFixtureGoogleKeyValue/);
});

async function importPreparationErrors() {
  const source = await readFile(preparationErrorsPath, "utf8");
  const redactionSource = await readFile(secretRedactionPath, "utf8");
  const compiled = ts.transpileModule(source.replace("./secretRedaction", "./secretRedaction.mjs"), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  }).outputText;
  const redactionCompiled = ts.transpileModule(redactionSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  }).outputText;
  const dir = await mkdtemp(path.join(os.tmpdir(), "mwb-react-preparation-errors-"));
  const modulePath = path.join(dir, "preparationErrors.mjs");
  const redactionModulePath = path.join(dir, "secretRedaction.mjs");
  await writeFile(modulePath, compiled);
  await writeFile(redactionModulePath, redactionCompiled);
  try {
    return await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
