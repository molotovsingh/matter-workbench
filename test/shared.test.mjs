import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCsv, parseCsvRow, toCsv } from "../shared/csv.mjs";
import { loadLocalEnv, parseEnvText, upsertLocalEnv } from "../shared/local-env.mjs";
import { isInsideRoot, validateMatterName, validateRelativePath } from "../shared/safe-paths.mjs";
import {
  effectiveShortSourceLabel,
  effectiveSourceLabel,
  sourceLabelContainsFileId,
  sourceLabelMetadata,
} from "../shared/source-labels.mjs";

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

test("source label helpers prefer confirmed labels and suppress FILE identifiers", () => {
  const source = {
    file_id: "FILE-0001",
    sha256: "hash-1",
    display_label: "Model label",
    short_label: "Model short",
    confirmed_label: "Confirmed agreement dated 20 April 2026",
    label_status: "confirmed",
    label_revision: 3,
  };

  assert.equal(effectiveSourceLabel(source), "Confirmed agreement dated 20 April 2026");
  assert.equal(effectiveShortSourceLabel(source, "fallback"), "Confirmed agreement dated 20 April 2026");
  assert.equal(sourceLabelContainsFileId("See FILE-0001"), true);
  assert.deepEqual(sourceLabelMetadata(source), {
    source_id: "FILE-0001",
    content_hash: "hash-1",
    document_type: "",
    document_date: "",
    needs_review: false,
    label_status: "confirmed",
    label_revision: 3,
    source_label: "Confirmed agreement dated 20 April 2026",
    source_short_label: "Confirmed agreement dated 20 April 2026",
  });

  assert.equal(sourceLabelMetadata({
    file_id: "FILE-0002",
    display_label: "Bad FILE-0002 label",
  }).source_label, undefined);
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

test("local env upsert writes through atomic temp files and preserves unrelated keys", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-env-upsert-test-"));
  await writeFile(path.join(tmp, ".env"), [
    "# existing local config",
    "OPENAI_MODEL=old-model",
    "MATTERS_HOME=/tmp/matters",
    "",
  ].join("\n"));

  const envPath = await upsertLocalEnv({
    appDir: tmp,
    values: {
      OPENAI_MODEL: "new-model",
      OPENAI_MAX_OUTPUT_TOKENS: "2048",
    },
  });

  assert.equal(envPath, path.join(tmp, ".env"));
  const text = await readFile(envPath, "utf8");
  assert.match(text, /OPENAI_MODEL=new-model/);
  assert.match(text, /OPENAI_MAX_OUTPUT_TOKENS=2048/);
  assert.match(text, /MATTERS_HOME=\/tmp\/matters/);
  assert.deepEqual((await readdir(tmp)).filter((name) => name.endsWith(".tmp")), []);
});
