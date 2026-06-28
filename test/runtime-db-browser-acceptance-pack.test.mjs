import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const packPath = new URL("../scripts/runtime-db-browser-acceptance-pack.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const docsPath = new URL("../docs/runtime-db-browser-acceptance-pack.md", import.meta.url);

test("runtime DB browser acceptance pack writes operator evidence from runtime and browser checks", async () => {
  const { runRuntimeDbBrowserAcceptancePack, renderRuntimeDbBrowserAcceptanceReport } = await import(packPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-browser-pack-"));
  const events = [];
  const fakeApp = {
    runtimeMatterIndex: {
      enabled: true,
      storageMode: "postgres",
      tenantId: "11111111-1111-4111-8111-111111111111",
    },
    server: {
      listen(_port, _host, callback) {
        events.push(["listen"]);
        callback();
      },
      address() {
        return { port: 49321 };
      },
      close(callback) {
        events.push(["close"]);
        callback?.();
      },
    },
  };

  const report = await runRuntimeDbBrowserAcceptancePack({
    outDir,
    timestamp: "2026-06-06T19:00:00.000Z",
    env: {
      MWB_RUNTIME_DATABASE_URL: "postgres://runtime:runtime-secret@db.example/mwb",
      MWB_PRIVATE_BETA_USERNAME: "operator",
      MWB_PRIVATE_BETA_PASSWORD: "private-secret",
    },
    createServer: async ({ env, host, port }) => {
      assert.equal(env.MWB_RUNTIME_DB, "postgres");
      assert.equal(env.MWB_RUNTIME_DB_STORAGE, "postgres");
      assert.equal(env.MWB_DB_RUNTIME_CUTOVER_APPROVED, "yes");
      assert.equal(host, "127.0.0.1");
      assert.equal(port, 0);
      return fakeApp;
    },
    runWriteSmoke: async ({ env }) => {
      assert.match(env.MWB_RUNTIME_DATABASE_URL, /^postgres:\/\/runtime:/);
      return {
        passed: true,
        roleGuardPassed: true,
        uploadCreated: true,
        workspaceReadable: true,
        filePreviewReadable: true,
        rawFileReadable: true,
        dbRowsVerified: true,
        rollbackVerified: true,
        cleanupDeleted: true,
        matterName: "Runtime DB Write Smoke",
      };
    },
    browserDriver: async ({ baseUrl, credentials }) => {
      assert.equal(baseUrl, "http://127.0.0.1:49321");
      assert.deepEqual(credentials, { username: "operator", password: "private-secret" });
      return {
        passed: true,
        driver: "injected-browser",
        checks: [
          { key: "react_root_loaded", passed: true, detail: "Matter Workbench rendered" },
          { key: "home_and_matter_navigation", passed: true, detail: "selected DB matter" },
          { key: "workspace_preview", passed: true, detail: "opened DB payload preview" },
          { key: "advisory_visible", passed: true, detail: "Preparation Advisory visible" },
          { key: "activity_receipts_visible", passed: true, detail: "Activity loaded" },
        ],
        consoleErrors: [],
        screenshot: "/private/tmp/runtime-db-browser-pack.png",
      };
    },
  });

  assert.equal(report.passed, true);
  assert.equal(report.schemaVersion, "runtime-db-browser-acceptance-pack/v1");
  assert.equal(report.runtimeDb.mode, "postgres/postgres");
  assert.equal(report.writeSmoke.passed, true);
  assert.equal(report.browser.passed, true);
  assert.equal(report.browser.checks.length, 5);
  assert.equal(existsSync(report.files.json), true);
  assert.equal(existsSync(report.files.markdown), true);
  assert.deepEqual(events, [["listen"], ["close"]]);

  const evidence = JSON.parse(await readFile(report.files.json, "utf8"));
  assert.equal(evidence.browser.driver, "injected-browser");
  assert.match(JSON.stringify(evidence), /workspace_preview/);
  assert.doesNotMatch(JSON.stringify(evidence), /runtime-secret/);
  assert.doesNotMatch(JSON.stringify(evidence), /private-secret/);

  const rendered = renderRuntimeDbBrowserAcceptanceReport(report).join("\n");
  assert.match(rendered, /Matter Workbench runtime DB browser acceptance pack/);
  assert.match(rendered, /passed: yes/);
  assert.match(rendered, /browser_passed: yes/);
});

test("runtime DB browser acceptance pack fails closed when browser checks are unavailable", async () => {
  const { runRuntimeDbBrowserAcceptancePack } = await import(packPath.href);
  const outDir = await mkdtemp(path.join(os.tmpdir(), "mwb-runtime-db-browser-pack-fail-"));

  const report = await runRuntimeDbBrowserAcceptancePack({
    outDir,
    timestamp: "2026-06-06T19:10:00.000Z",
    env: { MWB_RUNTIME_DATABASE_URL: "postgres://runtime:runtime-secret@db.example/mwb" },
    createServer: async () => ({
      runtimeMatterIndex: { enabled: true, storageMode: "postgres", tenantId: "tenant" },
      server: {
        listen(_port, _host, callback) { callback(); },
        address() { return { port: 49322 }; },
        close(callback) { callback?.(); },
      },
    }),
    runWriteSmoke: async () => ({ passed: true }),
    browserDriver: async () => ({
      passed: false,
      driver: "missing-playwright",
      checks: [{ key: "browser_driver", passed: false, detail: "Playwright is not available." }],
      consoleErrors: [],
    }),
  });

  assert.equal(report.passed, false);
  assert.equal(report.writeSmoke.passed, true);
  assert.equal(report.browser.passed, false);
  assert.match(report.browser.checks[0].detail, /Playwright/);
});

test("runtime DB browser acceptance uses mounted app navigation instead of silent global text clicks", async () => {
  const { clickAppNav } = await import(packPath.href);
  const calls = [];
  const clicked = [];
  const buttonLocator = {
    count: async () => 1,
    first: () => ({
      click: async () => { clicked.push("activity"); },
    }),
  };
  const navLocator = {
    getByRole: (_role, options) => {
      calls.push(["nav-role", String(options?.name)]);
      return buttonLocator;
    },
  };
  const page = {
    waitForSelector: async (selector) => { calls.push(["wait", selector]); },
    locator: (selector) => {
      calls.push(["locator", selector]);
      assert.equal(selector, 'nav[aria-label="App navigation"]');
      return navLocator;
    },
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
  };

  const result = await clickAppNav(page, ["Activity", "Recent work"]);

  assert.equal(result.clicked, true);
  assert.equal(result.label, "Activity");
  assert.equal(result.scope, 'nav[aria-label="App navigation"]');
  assert.deepEqual(clicked, ["activity"]);
  assert.deepEqual(calls[0], ["wait", '[aria-label="Workspace navigation"]']);
  assert.deepEqual(calls[1], ["wait", 'nav[aria-label="App navigation"] button']);
  assert.deepEqual(calls[2], ["locator", 'nav[aria-label="App navigation"]']);
});

test("runtime DB browser acceptance can use account footer navigation for settings", async () => {
  const { clickAppNav } = await import(packPath.href);
  const clicked = [];
  const appButton = { count: async () => 0 };
  const accountButton = {
    count: async () => 1,
    first: () => ({ click: async () => { clicked.push("settings"); } }),
  };
  const locators = {
    'nav[aria-label="App navigation"]': {
      getByRole: () => appButton,
    },
    '[aria-label="Account"]': {
      getByRole: () => accountButton,
    },
  };
  const page = {
    waitForSelector: async () => {},
    locator: (selector) => locators[selector],
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
  };

  const result = await clickAppNav(page, "Settings", [
    'nav[aria-label="App navigation"]',
    '[aria-label="Account"]',
  ]);

  assert.equal(result.clicked, true);
  assert.equal(result.label, "Settings");
  assert.equal(result.scope, '[aria-label="Account"]');
  assert.deepEqual(clicked, ["settings"]);
});

test("package and docs expose the runtime DB browser acceptance pack", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["db:runtime:browser-accept"], "node scripts/runtime-db-browser-acceptance-pack.mjs");

  const docs = await readFile(docsPath, "utf8");
  assert.match(docs, /db:runtime:browser-accept/);
  assert.match(docs, /runtime DB/i);
  assert.match(docs, /browser/i);
  assert.match(docs, /React/i);
  assert.match(docs, /Playwright/i);
});
