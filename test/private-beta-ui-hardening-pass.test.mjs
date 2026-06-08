import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const packPath = new URL("../scripts/private-beta-ui-hardening-pass.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const checklistPath = new URL("../docs/beta-operator-checklist.md", import.meta.url);
const docsPath = new URL("../docs/private-beta-ui-hardening-pass.md", import.meta.url);
const rcClosureDocsPath = new URL("../docs/private-beta-rc-closure-pack.md", import.meta.url);

test("private beta UI hardening pass parses operator options", async () => {
  const { parsePrivateBetaUiHardeningArgs } = await import(packPath.href);

  const defaults = parsePrivateBetaUiHardeningArgs([], {
    MWB_PRIVATE_VM_BASE_URL: "http://172.16.37.128:4191/",
    MWB_PRIVATE_BETA_USERNAME: "operator",
    MWB_PRIVATE_BETA_PASSWORD: "secret",
  });
  assert.equal(defaults.baseUrl, "http://172.16.37.128:4191");
  assert.equal(defaults.authUsername, "operator");
  assert.equal(defaults.authPassword, "secret");

  const parsed = parsePrivateBetaUiHardeningArgs([
    "--out-dir",
    ".local/ui-hardening",
    "--timestamp",
    "2026-06-08T05:30:00.000Z",
    "--base-url",
    "http://127.0.0.1:4191/",
    "--auth-username",
    "aks",
    "--auth-password",
    "private-secret",
  ], {});

  assert.equal(parsed.baseUrl, "http://127.0.0.1:4191");
  assert.equal(parsed.timestamp, "2026-06-08T05:30:00.000Z");
  assert.equal(parsed.authUsername, "aks");
  assert.equal(parsed.authPassword, "private-secret");
  assert.match(parsed.outDir, /ui-hardening$/);
});

test("private beta UI hardening pass writes redacted rendered-UX evidence", async () => {
  const { runPrivateBetaUiHardeningPass, renderPrivateBetaUiHardeningPassResult } = await import(packPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-ui-hardening-pass-"));
  const calls = [];

  const result = await runPrivateBetaUiHardeningPass({
    outDir,
    timestamp: "2026-06-08T05:30:00.000Z",
    baseUrl: "http://172.16.37.128:4191",
    authUsername: "operator",
    authPassword: "private-secret",
    browserCheckFn: async ({ baseUrl, authUsername, authPassword, screenshotDir }) => {
      calls.push({ baseUrl, authUsername, authPassword, screenshotDir });
      return {
        passed: true,
        driver: "injected-browser",
        checks: [
          { key: "home_shell", passed: true, detail: "Matter Workbench rendered" },
          { key: "settings_secret_leak", passed: true, detail: "No sk-live-secret or postgres://user:db-secret@example/mwb shown" },
          { key: "mobile_overflow", passed: true, detail: "No overflow" },
        ],
        consoleErrors: [],
        screenshots: [
          { label: "home_desktop", path: path.join(screenshotDir, "home-desktop.png") },
          { label: "home_mobile", path: path.join(screenshotDir, "home-mobile.png") },
        ],
      };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.schemaVersion, "private-beta-ui-hardening-pass/v1");
  assert.equal(result.baseUrl, "http://172.16.37.128:4191");
  assert.equal(result.browser.driver, "injected-browser");
  assert.equal(result.browser.checks.length, 3);
  assert.equal(result.browser.screenshots.length, 2);
  assert.equal(existsSync(result.files.json), true);
  assert.equal(existsSync(result.files.markdown), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].authPassword, "private-secret");

  const evidenceText = await readFile(result.files.json, "utf8");
  assert.doesNotMatch(evidenceText, /sk-live-secret/);
  assert.doesNotMatch(evidenceText, /db-secret/);
  assert.doesNotMatch(evidenceText, /private-secret/);
  assert.match(evidenceText, /\[redacted-secret\]|\*\*\*/);

  const markdown = await readFile(result.files.markdown, "utf8");
  assert.match(markdown, /Private Beta UI Hardening Pass/);
  assert.match(markdown, /home_shell/);
  assert.match(markdown, /home-desktop\.png/);

  const rendered = renderPrivateBetaUiHardeningPassResult(result).join("\n");
  assert.match(rendered, /Matter Workbench private beta UI hardening pass/);
  assert.match(rendered, /success: yes/);
  assert.match(rendered, /checks: 3\/3/);
});

test("private beta UI hardening pass fails closed on broken visible UX or console errors", async () => {
  const { runPrivateBetaUiHardeningPass } = await import(packPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-ui-hardening-pass-fail-"));

  const result = await runPrivateBetaUiHardeningPass({
    outDir,
    timestamp: "2026-06-08T05:30:00.000Z",
    browserCheckFn: async () => ({
      passed: false,
      driver: "injected-browser",
      checks: [
        { key: "home_shell", passed: true, detail: "Matter Workbench rendered" },
        { key: "skills_page", passed: false, detail: "Skills page showed Missing data" },
      ],
      consoleErrors: ["OPENAI_API_KEY=sk-console-secret exploded"],
      screenshots: [],
    }),
  });

  assert.equal(result.success, false);
  assert.match(result.failedChecks.join(","), /skills_page/);
  assert.match(result.failedChecks.join(","), /console_errors/);

  const evidenceText = await readFile(result.files.json, "utf8");
  assert.doesNotMatch(evidenceText, /sk-console-secret/);
});

test("private beta UI hardening pass waits for home surfaces after login", async () => {
  const { waitForHomeSurface } = await import(packPath.href);
  const selectors = [];
  const functions = [];
  const page = {
    waitForSelector: async (selector, options) => {
      selectors.push([selector, options?.timeout]);
    },
    waitForFunction: async (fn, arg, options) => {
      functions.push([String(fn), arg, options?.timeout]);
    },
  };

  await waitForHomeSurface(page);

  assert.deepEqual(selectors, [
    ["body", 60000],
  ]);
  assert.equal(functions.length, 1);
  assert.match(functions[0][0], /what do you want to do today/);
  assert.match(functions[0][0], /files loaded from the matter folder/);
  assert.equal(functions[0][2], 60000);
});

test("private beta UI hardening pass accepts either Start screen or active matter overview", async () => {
  const { homeStartStateCheck } = await import(packPath.href);

  const startPage = fakeBodyPage("HOME\nWhat do you want to do today?\nAdd a new matter\nFind an existing matter\nLearn how this works");
  const activeMatterPage = fakeBodyPage("Atlas Construction vs Diptishree\n57 files loaded from the matter folder.");
  const blankPage = fakeBodyPage("HOME\nGood morning.");

  assert.equal((await homeStartStateCheck(startPage)).passed, true);
  assert.equal((await homeStartStateCheck(activeMatterPage)).passed, true);
  assert.equal((await homeStartStateCheck(blankPage)).passed, false);
});

test("private beta UI hardening pass stops before Home checks when login cannot proceed", async () => {
  const source = await readFile(packPath, "utf8");

  assert.match(source, /const loginReady = await loginIfRequired\(page/);
  assert.match(source, /if \(!loginReady\) return renderChecksResult/);
  assert.match(source, /Login screen appeared but credentials were not provided[\s\S]*return false;/);
});

test("package and operator docs expose the private beta UI hardening pass", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["private-beta:ui-hardening-pass"], "node scripts/private-beta-ui-hardening-pass.mjs");

  const checklist = await readFile(checklistPath, "utf8");
  assert.match(checklist, /private-beta:ui-hardening-pass/);
  assert.match(checklist, /rendered UI hardening/i);

  const docs = await readFile(docsPath, "utf8");
  assert.match(docs, /private-beta:ui-hardening-pass/);
  assert.match(docs, /What it checks/i);

  const closureDocs = await readFile(rcClosureDocsPath, "utf8");
  assert.match(closureDocs, /private-beta-ui-hardening-passes/);
  assert.match(closureDocs, /rendered UI hardening/i);
});

function fakeBodyPage(text) {
  return {
    locator: () => ({
      innerText: async () => text,
    }),
  };
}
