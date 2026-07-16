import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const themePath = new URL("../react-ui/src/lib/theme.ts", import.meta.url);

async function importThemeModule() {
  const source = await readFile(themePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("React theme helper normalizes, toggles, and tolerates unavailable storage", async () => {
  const { nextTheme, normalizeTheme, readStoredTheme } = await importThemeModule();

  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(normalizeTheme("unsafe"), "light");
  assert.equal(nextTheme("dark"), "light");
  assert.equal(nextTheme("light"), "dark");
  assert.equal(readStoredTheme({ getItem: () => "dark" }), "dark");
  assert.equal(readStoredTheme({ getItem: () => "invalid" }), "light");
  assert.equal(readStoredTheme({ getItem: () => { throw new Error("blocked"); } }), "light");
});
