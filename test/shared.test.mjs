import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCsv, parseCsvRow, toCsv } from "../shared/csv.mjs";
import { loadLocalEnv, parseEnvText, upsertLocalEnv } from "../shared/local-env.mjs";
import {
  LIST_OF_DATES_CSV_RELATIVE,
  LIST_OF_DATES_JSON_RELATIVE,
  LIST_OF_DATES_MARKDOWN_RELATIVE,
  MATTER_LIBRARY_DIR,
  SOURCE_INDEX_RELATIVE,
} from "../shared/matter-artifacts.mjs";
import {
  assertInsideRoot,
  isInsideRoot,
  validateMatterName,
  validateRelativePath,
} from "../shared/safe-paths.mjs";
import { redactSensitiveText, redactSensitiveValues, REDACTED_SECRET } from "../shared/secret-redaction.mjs";
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

test("safe path helpers emit stable diagnostic codes", () => {
  assertRejectsCode(() => validateMatterName("../bad"), "path.invalid_matter_name", 400);
  assertRejectsCode(() => validateRelativePath(""), "path.empty", 400);
  assertRejectsCode(() => validateRelativePath("/tmp/file.txt"), "path.absolute_not_allowed", 400);
  assertRejectsCode(() => validateRelativePath("folder/../file.txt"), "path.invalid_segment", 400);
  assertRejectsCode(() => assertInsideRoot("/tmp/root", "/tmp/rooted/a.txt"), "path.outside_root", 403);
});

function assertRejectsCode(operation, code, statusCode) {
  let thrown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, `expected ${code} to be thrown`);
  assert.equal(thrown.code, code);
  assert.equal(thrown.statusCode, statusCode);
}

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

test("matter artifact path constants keep native Library outputs aligned", () => {
  assert.equal(MATTER_LIBRARY_DIR, "10_Library");
  assert.equal(SOURCE_INDEX_RELATIVE, "10_Library/Source Index.json");
  assert.equal(LIST_OF_DATES_JSON_RELATIVE, "10_Library/List of Dates.json");
  assert.equal(LIST_OF_DATES_CSV_RELATIVE, "10_Library/List of Dates.csv");
  assert.equal(LIST_OF_DATES_MARKDOWN_RELATIVE, "10_Library/List of Dates.md");
});

test("secret redaction helper covers provider keys and bearer tokens", () => {
  const text = [
    "OPENAI_API_KEY=sk-openai-secret",
    "OPENROUTER_API_KEY='sk-openrouter-secret'",
    "MISTRAL_API_KEY=\"sk-mistral-secret\"",
    "authorization: Bearer sk-bearer-secret",
    "Authorization: Bearer mistral-token-secret",
    '"apiKey": "future-provider-token"',
    "x-api-key=opaque-provider-token",
    "raw sk-raw-secret",
    "google key AIzaSyFixtureGoogleKeyValue",
  ].join("\n");

  const redacted = redactSensitiveText(text);

  assert.doesNotMatch(
    redacted,
    /sk-openai-secret|sk-openrouter-secret|sk-mistral-secret|sk-bearer-secret|mistral-token-secret|future-provider-token|opaque-provider-token|sk-raw-secret|AIzaSyFixtureGoogleKeyValue/,
  );
  assert.match(redacted, new RegExp(`OPENAI_API_KEY=${escapeRegExp(REDACTED_SECRET)}`));
  assert.match(redacted, new RegExp(`OPENROUTER_API_KEY=${escapeRegExp(REDACTED_SECRET)}`));
  assert.match(redacted, new RegExp(`MISTRAL_API_KEY=${escapeRegExp(REDACTED_SECRET)}`));
  assert.match(redacted, new RegExp(`Bearer ${escapeRegExp(REDACTED_SECRET)}`));
  assert.match(redacted, new RegExp(`"apiKey":${escapeRegExp(REDACTED_SECRET)}`));
  assert.match(redacted, new RegExp(`x-api-key=${escapeRegExp(REDACTED_SECRET)}`));
});

test("secret redaction helper covers connection strings, ingestion tokens, and generic secret pairs", () => {
  const text = [
    "connect failed: postgres://operator:fixture-pass@db.internal:5432/mothership",
    "POSTGRESQL url postgresql://operator:fixture-pass@db.internal:5432/db",
    "sync rejected mwb_ing_fixture-ingestion-token",
    "MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN=fixture-sync-token",
    "login failed password: fixture-pass",
    "retry with token=fixture-token",
    '{"password":"quoted-pass","token":"quoted-token","secret":"quoted-secret"}',
  ].join("\n");

  const redacted = redactSensitiveText(text);

  assert.doesNotMatch(redacted, /fixture-pass|fixture-ingestion-token|fixture-sync-token|fixture-token|quoted-pass|quoted-token|quoted-secret/);
  assert.match(redacted, /postgres:\/\/operator:\*\*\*@db\.internal:5432\/mothership/);
  assert.match(redacted, /postgresql:\/\/operator:\*\*\*@db\.internal:5432\/db/);
  assert.match(redacted, new RegExp(`mwb_ing_${escapeRegExp(REDACTED_SECRET)}`));
  assert.match(redacted, new RegExp(`MWB_PRIVATE_BETA_FEEDBACK_SYNC_TOKEN=${escapeRegExp(REDACTED_SECRET)}`));
  assert.match(redacted, new RegExp(`password=${escapeRegExp(REDACTED_SECRET)}`));
});

test("secret redaction walks JSON-shaped values for verbatim serialization", () => {
  const redacted = redactSensitiveValues({
    runtime: {
      lastError: "connect failed: postgres://operator:fixture-pass@db.internal:5432/mothership",
      diskFreePercent: 42,
    },
    notes: ["token=fixture-token", { detail: "Bearer fixture-bearer" }],
    enabled: true,
  });

  assert.equal(redacted.runtime.diskFreePercent, 42);
  assert.equal(redacted.enabled, true);
  assert.doesNotMatch(JSON.stringify(redacted), /fixture-pass|fixture-token|fixture-bearer/);
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
