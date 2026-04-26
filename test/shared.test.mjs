import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, parseCsvRow, toCsv } from "../shared/csv.mjs";
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
