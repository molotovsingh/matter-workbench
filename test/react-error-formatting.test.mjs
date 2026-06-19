import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const errorsPath = new URL("../react-ui/src/lib/errors.ts", import.meta.url);
const reactSecretRedactionPath = new URL("../react-ui/src/lib/secretRedaction.ts", import.meta.url);
const workspaceTreePath = new URL("../react-ui/src/components/workspace/WorkspaceTree.tsx", import.meta.url);

test("React error formatter keeps diagnostic codes opt-in", async () => {
  const { getErrorMessage } = await importReactErrors();
  const error = new Error("File not found");
  error.code = "runtime_db.read.file_not_found";

  assert.equal(getErrorMessage(error), "File not found");
  assert.equal(
    getErrorMessage(error, { includeCode: true }),
    "File not found (code: runtime_db.read.file_not_found)",
  );
});

test("React error formatter redacts secrets before rendering", async () => {
  const { getErrorMessage } = await importReactErrors();
  const error = new Error("provider failed OPENROUTER_API_KEY=sk-react-secret");

  assert.equal(getErrorMessage(error), "provider failed OPENROUTER_API_KEY=[redacted-secret]");
  assert.doesNotMatch(getErrorMessage(error), /sk-react-secret/);
});

test("React error formatter falls back to diagnostic code and rejects unsafe codes", async () => {
  const { getErrorMessage } = await importReactErrors();
  const diagnosticOnly = Object.assign(new Error("Payload missing"), {
    diagnostic: { code: "runtime_db.read.payload_missing" },
  });
  const unsafe = Object.assign(new Error("Bad input"), {
    code: "runtime_db.read.bad<script>",
  });

  assert.equal(
    getErrorMessage(diagnosticOnly, { includeCode: true }),
    "Payload missing (code: runtime_db.read.payload_missing)",
  );
  assert.equal(getErrorMessage(unsafe, { includeCode: true }), "Bad input");
});

test("Workspace file preview exposes diagnostic codes only in the operator error branch", async () => {
  const source = await readFile(workspaceTreePath, "utf8");

  assert.match(source, /getErrorMessage\(e, \{ includeCode: true \}\)/);
  assert.match(source, /showOperatorChrome\s*\?\s*`\[file\] error reading/);
  assert.match(source, /Could not open that file\. Please try again or tell us what happened\./);
});

async function importReactErrors() {
  const secretRedactionUrl = await transpiledDataUrl(reactSecretRedactionPath);
  const source = await readFile(errorsPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  }).outputText.replace("from './secretRedaction';", `from '${secretRedactionUrl}';`);
  const dir = await mkdtemp(path.join(os.tmpdir(), "mwb-react-errors-"));
  const modulePath = path.join(dir, "errors.mjs");
  await writeFile(modulePath, compiled);
  try {
    return await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function transpiledDataUrl(fileUrl) {
  const source = await readFile(fileUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}
