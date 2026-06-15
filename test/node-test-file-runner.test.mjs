import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const runnerPath = new URL("../scripts/node-test-file-runner.mjs", import.meta.url);

test("node test file runner executes test files one at a time and summarizes failures", async () => {
  const { runNodeTestsFileByFile } = await import(runnerPath.href);
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-node-file-runner-"));
  const testDir = path.join(root, "test");
  await mkdir(path.join(testDir, "nested"), { recursive: true });
  await writeFile(path.join(testDir, "a-pass.test.mjs"), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('passes', () => assert.equal(1, 1));",
    "",
  ].join("\n"));
  await writeFile(path.join(testDir, "nested", "b-fail.test.mjs"), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('fails', () => assert.equal(1, 2));",
    "",
  ].join("\n"));

  const result = await runNodeTestsFileByFile({ cwd: root, testDir });

  assert.equal(result.ok, false);
  assert.equal(result.total, 2);
  assert.equal(result.passed, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.files.map((file) => file.relativePath), [
    "test/a-pass.test.mjs",
    "test/nested/b-fail.test.mjs",
  ]);
  assert.equal(result.files[0].ok, true);
  assert.equal(result.files[1].ok, false);
  assert.match(result.outputLines.join("\n"), /ok test\/a-pass\.test\.mjs/);
  assert.match(result.outputLines.join("\n"), /not ok test\/nested\/b-fail\.test\.mjs/);
  assert.match(result.outputLines.join("\n"), /failed files:\n- test\/nested\/b-fail\.test\.mjs/);
  assert.match(result.outputLines.join("\n"), /failed file diagnostics:\n--- test\/nested\/b-fail\.test\.mjs ---/);
  assert.match(result.files[1].outputTail, /Expected values to be strictly equal/);
});

test("node test file runner CLI exits nonzero on failed test files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-node-file-runner-cli-"));
  const testDir = path.join(root, "test");
  await mkdir(testDir, { recursive: true });
  await writeFile(path.join(testDir, "fail.test.mjs"), [
    "import test from 'node:test';",
    "test('fails', () => { throw new Error('fixture failure'); });",
    "",
  ].join("\n"));

  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [runnerPath.pathname, "--test-dir", testDir], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  const code = await new Promise((resolve) => child.on("close", resolve));

  assert.equal(code, 1);
  assert.match(Buffer.concat(chunks).toString("utf8"), /failed=1/);
});

test("node test file runner fails a wedged test file with a timeout diagnostic", async () => {
  const { runNodeTestsFileByFile } = await import(runnerPath.href);
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-node-file-runner-timeout-"));
  const testDir = path.join(root, "test");
  await mkdir(testDir, { recursive: true });
  await writeFile(path.join(testDir, "hang.test.mjs"), [
    "import test from 'node:test';",
    "test('hangs', () => new Promise(() => {}));",
    "",
  ].join("\n"));

  const result = await runNodeTestsFileByFile({ cwd: root, testDir, timeoutMs: 50 });

  assert.equal(result.ok, false);
  assert.equal(result.total, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.files[0].timedOut, true);
  assert.match(result.files[0].outputTail, /Timed out after 50ms/);
});
