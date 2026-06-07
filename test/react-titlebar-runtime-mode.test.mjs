import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const titleBarPath = new URL("../react-ui/src/components/layout/TitleBar.tsx", import.meta.url);
const typesPath = new URL("../react-ui/src/types/index.ts", import.meta.url);

test("React TitleBar renders workspace mode from config instead of a hardcoded local label", async () => {
  const source = await readFile(titleBarPath, "utf8");

  assert.match(source, /workspaceModeLabel/);
  assert.doesNotMatch(source, /<span className="workspace-mode">Local workspace<\/span>/);
});

test("React AppConfig carries runtime storage mode and display label", async () => {
  const source = await readFile(typesPath, "utf8");
  const appConfigMatch = source.match(/export interface AppConfig \{([\s\S]*?)\n\}/);
  const body = appConfigMatch?.[1] || "";

  assert.match(body, /runtimeStorageMode\?:/);
  assert.match(body, /workspaceModeLabel\?: string/);
});
