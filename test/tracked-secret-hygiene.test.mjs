import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("tracked files do not contain known local VM credentials", async () => {
  const { stdout } = await execFileAsync("git", ["ls-files"]);
  const trackedFiles = stdout.split("\n").filter(Boolean);
  const forbiddenPatterns = [
    ["local VM password", new RegExp(["aks", "ingh11"].join(""))],
  ];
  const matches = [];

  for (const file of trackedFiles) {
    let text = "";
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const [label, pattern] of forbiddenPatterns) {
      if (pattern.test(text)) matches.push(`${file}: ${label}`);
    }
  }

  assert.deepEqual(matches, []);
});
