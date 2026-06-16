import assert from "node:assert/strict";
import test from "node:test";

const scriptPath = new URL("../scripts/db-credit-shadow-report.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);

test("credit shadow report CLI parses safe report options", async () => {
  const { parseArgs } = await import(scriptPath.href);

  assert.equal(parseArgs(["--json"]).json, true);
  assert.equal(parseArgs(["--app-dir", "/tmp/app"]).appDir, "/tmp/app");
  assert.equal(parseArgs(["--matters-home", "/tmp/matters"]).mattersHome, "/tmp/matters");
  assert.throws(() => parseArgs(["--app-dir"]), /requires a value/);
  assert.throws(() => parseArgs(["--wat"]), /Unknown option/);
});

test("credit shadow report exposes a no-write script", async () => {
  const pkg = JSON.parse(await (await import("node:fs/promises")).readFile(packagePath, "utf8"));

  assert.equal(pkg.scripts["db:credits:shadow:report"], "node scripts/db-credit-shadow-report.mjs");
});
