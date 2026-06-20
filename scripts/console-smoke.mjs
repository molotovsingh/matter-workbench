#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, "..", "mothership", "console", "dist");

const checks = [];

function pass(label, detail = "") {
  checks.push({ ok: true, label, detail });
}

function fail(label, detail) {
  checks.push({ ok: false, label, detail });
}

function assert(condition, label, detail) {
  if (condition) pass(label, detail);
  else fail(label, detail);
}

async function listFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(fullPath, ext));
    else if (!ext || entry.name.endsWith(ext)) out.push(fullPath);
  }
  return out;
}

async function run() {
  if (!existsSync(distRoot)) {
    fail("Console dist directory exists", `expected ${distRoot} — run npm run console:build first`);
    return report();
  }

  try {
    const html = await readFile(path.join(distRoot, "index.html"), "utf8");
    assert(html.includes("<title>Matter Workbench · Mothership Console</title>"), "Console HTML has the console title");
    assert(html.includes('id="root"'), "Console HTML has a root mount point");
    assert(/<script[^>]+type="module"[^>]*>/.test(html), "Console HTML loads a module script");
  } catch (error) {
    fail("Console HTML is readable", error.message);
  }

  const jsFiles = await listFiles(path.join(distRoot, "assets"), ".js");
  assert(jsFiles.length > 0, "Console build emits at least one JS asset", `${jsFiles.length} JS file(s)`);
  if (jsFiles.length > 0) {
    try {
      const bundled = await Promise.all(jsFiles.map((file) => readFile(file, "utf8")));
      const source = bundled.join("\n");
      assert(source.includes("/api/auth/status"), "Console bundle calls the auth status endpoint");
      assert(source.includes("/api/installations"), "Console bundle calls the installations endpoint");
      assert(source.includes("/api/report"), "Console bundle calls the report endpoint");
      assert(source.includes("Mothership Console"), "Console bundle contains the app title");
    } catch (error) {
      fail("Console JS bundle is readable", error.message);
    }
  }

  const cssFiles = await listFiles(path.join(distRoot, "assets"), ".css");
  assert(cssFiles.length > 0, "Console build emits CSS", `${cssFiles.length} CSS file(s)`);

  return report();
}

function report() {
  const failed = checks.filter((check) => !check.ok);
  for (const check of checks) {
    const marker = check.ok ? "OK" : "FAIL";
    const detail = check.detail ? ` — ${check.detail}` : "";
    console.log(`${marker} ${check.label}${detail}`);
  }
  if (failed.length > 0) {
    console.error(`\nConsole smoke failed: ${failed.length}/${checks.length} checks failed.`);
    process.exit(1);
  }
  console.log(`\nConsole smoke passed: ${checks.length}/${checks.length} checks passed.`);
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
