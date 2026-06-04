import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function isIgnored(pathname) {
  try {
    await execFileAsync("git", ["check-ignore", "--no-index", "-q", pathname]);
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    throw error;
  }
}

test("tracked files do not contain known local VM credentials", async () => {
  const { stdout } = await execFileAsync("git", ["ls-files"]);
  const trackedFiles = stdout.split("\n").filter(Boolean);
  const forbiddenPatterns = [
    ["local VM password", new RegExp(["aks", "ingh11"].join(""))],
    ["password placeholder", new RegExp(["choose", "a", "password", "here"].join("-"))],
    ["local VM subnet", /192\.168\.210\./],
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

test("local env variants are ignored while the example env remains trackable", async () => {
  assert.equal(await isIgnored(".env"), true);
  assert.equal(await isIgnored(".env.local"), true);
  assert.equal(await isIgnored(".env.shadow"), true);
  assert.equal(await isIgnored(".env.development"), true);
  assert.equal(await isIgnored(".envrc"), true);
  assert.equal(await isIgnored(".env.example"), false);
});
