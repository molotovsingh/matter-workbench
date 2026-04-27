import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCsv, parseCsvRow, toCsv } from "../shared/csv.mjs";
import { loadLocalEnv, parseEnvText } from "../shared/local-env.mjs";
import { isInsideRoot, validateMatterName, validateRelativePath } from "../shared/safe-paths.mjs";

test("CSV parser and writer preserve quoted fields", () => {
  const rows = [
    { name: "Alpha, Beta", note: "He said \"yes\"", empty: "" },
    { name: "Line", note: "one\ntwo", empty: "" },
  ];
  const csv = toCsv(rows, ["name", "note", "empty"]);
  assert.deepEqual(parseCsv(csv), rows);
  assert.deepEqual(parseCsvRow('"a,b","c""d",'), ["a,b", 'c"d', ""]);
});

test("safe path helpers reject path escapes", () => {
  assert.equal(validateMatterName("Mehta vs Skyline"), "Mehta vs Skyline");
  assert.throws(() => validateMatterName("../bad"), /Invalid matter name/);
  assert.equal(validateRelativePath("folder/file.txt"), "folder/file.txt");
  assert.throws(() => validateRelativePath("/tmp/file.txt"), /Absolute paths/);
  assert.throws(() => validateRelativePath("folder/../file.txt"), /Invalid path segment/);
  assert.equal(isInsideRoot("/tmp/root", "/tmp/root/a.txt"), true);
  assert.equal(isInsideRoot("/tmp/root", "/tmp/rooted/a.txt"), false);
});

test("local env parser supports named and raw OpenAI keys", async () => {
  assert.deepEqual(parseEnvText("OPENAI_MODEL=test-model\n"), { OPENAI_MODEL: "test-model" });
  assert.deepEqual(parseEnvText("sk-test_raw_key\n"), { OPENAI_API_KEY: "sk-test_raw_key" });

  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-env-test-"));
  const appDir = path.join(tmp, "app");
  await mkdir(appDir, { recursive: true });
  await writeFile(path.join(tmp, ".env"), "sk-parent_raw_key\nOPENAI_MODEL=parent-model\n");
  await writeFile(path.join(appDir, ".env"), "OPENAI_MODEL=app-model\n");

  const targetEnv = {};
  const loaded = await loadLocalEnv({ appDir, targetEnv });
  assert.equal(targetEnv.OPENAI_API_KEY, "sk-parent_raw_key");
  assert.equal(targetEnv.OPENAI_MODEL, "app-model");
  assert.equal(loaded.loadedPaths.length, 2);

  const overrideEnv = { OPENAI_API_KEY: "sk-old_key" };
  await loadLocalEnv({ appDir, targetEnv: overrideEnv, override: true });
  assert.equal(overrideEnv.OPENAI_API_KEY, "sk-parent_raw_key");
});
