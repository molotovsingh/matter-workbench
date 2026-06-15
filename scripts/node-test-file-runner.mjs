#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);

export async function runNodeTestsFileByFile({
  cwd = process.cwd(),
  testDir = path.join(cwd, "test"),
  nodeArgs = ["--test"],
  timeoutMs = 120_000,
} = {}) {
  const files = await findTestFiles(testDir);
  const results = [];
  const outputLines = [];

  for (const filePath of files) {
    const relativePath = path.relative(cwd, filePath);
    const result = await runCommand({
      cwd,
      command: process.execPath,
      args: [...nodeArgs, filePath],
      env: childTestEnv(),
      timeoutMs,
    });
    const fileResult = {
      relativePath,
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      outputTail: tailText(`${result.stdout}${result.stderr}`),
    };
    results.push(fileResult);
    outputLines.push(`${fileResult.ok ? "ok" : "not ok"} ${relativePath}`);
    if (!fileResult.ok && fileResult.outputTail) outputLines.push(fileResult.outputTail);
  }

  const failed = results.filter((result) => !result.ok).length;
  if (failed > 0) {
    const failedResults = results.filter((fileResult) => !fileResult.ok);
    outputLines.push("failed files:");
    for (const result of failedResults) {
      outputLines.push(`- ${result.relativePath}${result.timedOut ? " (timed out)" : ""}`);
    }
    outputLines.push("failed file diagnostics:");
    for (const result of failedResults) {
      outputLines.push(`--- ${result.relativePath}${result.timedOut ? " (timed out)" : ""} ---`);
      if (result.outputTail) outputLines.push(result.outputTail);
    }
  }
  return {
    ok: failed === 0,
    total: results.length,
    passed: results.length - failed,
    failed,
    files: results,
    outputLines,
  };
}

async function findTestFiles(testDir) {
  const entries = await readdir(testDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(testDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findTestFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
      files.push(entryPath);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function runCommand({ cwd, command, args, env = process.env, timeoutMs = 120_000 }) {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({
        stdout,
        stderr: `${stderr}\nTimed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`,
        exitCode: 1,
        timedOut: true,
      });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}${error.message}`, exitCode: 1, timedOut: false });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1, timedOut: false });
    });
  });
}

function childTestEnv(sourceEnv = process.env) {
  const env = { ...sourceEnv };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return env;
}

function tailText(value, max = 2400) {
  const text = String(value || "");
  return text.length <= max ? text : text.slice(-max);
}

async function main() {
  const args = process.argv.slice(2);
  let testDir = path.join(process.cwd(), "test");
  let timeoutMs = 120_000;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--test-dir") {
      testDir = path.resolve(args[index + 1] || "");
      index += 1;
    } else if (args[index] === "--timeout-ms") {
      timeoutMs = Number.parseInt(args[index + 1] || "", 10);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("--timeout-ms must be a positive integer");
      index += 1;
    } else {
      throw new Error(`Unknown option: ${args[index]}`);
    }
  }
  const result = await runNodeTestsFileByFile({ testDir, timeoutMs });
  for (const line of result.outputLines) console.log(line);
  console.log(`total=${result.total} passed=${result.passed} failed=${result.failed}`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
