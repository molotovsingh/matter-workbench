import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const preparationErrorsPath = new URL("../react-ui/src/lib/preparationErrors.ts", import.meta.url);

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

test("preparation errors redact secrets while preserving useful plain errors", async () => {
  const { formatVisiblePreparationError } = await importPreparationErrors();

  const message = formatVisiblePreparationError(
    new Error("Provider failed with OPENAI_API_KEY=sk-hidden and token=abc123"),
  );

  assert.match(message, /Provider failed/i);
  assert.match(message, /OPENAI_API_KEY=\[redacted-secret\]/);
  assert.match(message, /token=\[redacted-secret\]/);
  assert.doesNotMatch(message, /sk-hidden|abc123/);
});

async function importPreparationErrors() {
  const source = await readFile(preparationErrorsPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  }).outputText;
  const dir = await mkdtemp(path.join(os.tmpdir(), "mwb-react-preparation-errors-"));
  const modulePath = path.join(dir, "preparationErrors.mjs");
  await writeFile(modulePath, compiled);
  try {
    return await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
