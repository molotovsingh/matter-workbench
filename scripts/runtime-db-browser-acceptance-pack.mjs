#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { createWorkbenchServer } from "../server.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { runRuntimeDbWriteSmoke } from "./db-runtime-write-smoke.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";

const __filename = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const SCHEMA_VERSION = "runtime-db-browser-acceptance-pack/v1";

export function parseRuntimeDbBrowserAcceptanceArgs(argv = []) {
  const parsed = {
    outDir: path.resolve(".local", "runtime-db-browser-acceptance-packs"),
    timestamp: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out-dir requires a value");
      parsed.outDir = path.resolve(value);
      i += 1;
    } else if (arg === "--timestamp") {
      const value = argv[i + 1];
      if (!value) throw new Error("--timestamp requires a value");
      parsed.timestamp = value;
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function runRuntimeDbBrowserAcceptancePack({
  env = process.env,
  outDir = path.resolve(".local", "runtime-db-browser-acceptance-packs"),
  timestamp = new Date().toISOString(),
  createServer = createWorkbenchServer,
  runWriteSmoke = runRuntimeDbWriteSmoke,
  browserDriver = runPlaywrightBrowserAcceptance,
  now = () => new Date(),
} = {}) {
  const generatedAt = timestamp || now().toISOString();
  const slug = timestampSlug(generatedAt);
  const packDir = path.join(outDir, `runtime-db-browser-acceptance-pack-${slug}`);
  await mkdir(packDir, { recursive: true });

  const runtimeEnv = runtimeDbBrowserAcceptanceEnv(env);
  const report = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    passed: false,
    runtimeDb: {
      enabled: false,
      mode: "",
      tenantId: String(runtimeEnv.MWB_RUNTIME_DB_TENANT_ID || ""),
    },
    writeSmoke: {},
    browser: {
      passed: false,
      driver: "",
      checks: [],
      consoleErrors: [],
      screenshot: "",
    },
    files: {},
    error: "",
  };

  let app = null;
  try {
    report.writeSmoke = sanitizeEvidence(await runWriteSmoke({ env: runtimeEnv }));

    app = await createServer({
      env: runtimeEnv,
      host: "127.0.0.1",
      port: 0,
    });
    report.runtimeDb = {
      enabled: Boolean(app.runtimeMatterIndex?.enabled),
      mode: `${String(runtimeEnv.MWB_RUNTIME_DB || "")}/${String(runtimeEnv.MWB_RUNTIME_DB_STORAGE || "")}`,
      storageMode: app.runtimeMatterIndex?.storageMode || "",
      tenantId: app.runtimeMatterIndex?.tenantId || String(runtimeEnv.MWB_RUNTIME_DB_TENANT_ID || ""),
    };
    if (!report.runtimeDb.enabled || report.runtimeDb.storageMode !== "postgres") {
      throw new Error("Runtime DB browser acceptance requires MWB_RUNTIME_DB=postgres and MWB_RUNTIME_DB_STORAGE=postgres.");
    }

    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    report.browser = sanitizeEvidence(await browserDriver({
      baseUrl,
      credentials: privateBetaCredentials(runtimeEnv),
      env: runtimeEnv,
      generatedAt,
    }));
    report.passed = Boolean(report.writeSmoke?.passed && report.browser?.passed && report.runtimeDb.enabled);
  } catch (error) {
    report.error = redactRuntimeDbBrowserAcceptanceLine(error.message);
  } finally {
    if (app?.server) await new Promise((resolve) => app.server.close(resolve));
  }

  report.files = await writeRuntimeDbBrowserAcceptanceEvidence({ report, packDir });
  return report;
}

export function renderRuntimeDbBrowserAcceptanceReport(report = {}) {
  const lines = [
    "Matter Workbench runtime DB browser acceptance pack",
    `passed: ${report.passed ? "yes" : "no"}`,
    `schema_version: ${report.schemaVersion || ""}`,
    `generated_at: ${report.generatedAt || ""}`,
    `runtime_db_enabled: ${report.runtimeDb?.enabled ? "yes" : "no"}`,
    `runtime_db_mode: ${report.runtimeDb?.mode || ""}`,
    `runtime_db_storage_mode: ${report.runtimeDb?.storageMode || ""}`,
    `tenant_id: ${report.runtimeDb?.tenantId || ""}`,
    `write_smoke_passed: ${report.writeSmoke?.passed ? "yes" : "no"}`,
    `browser_passed: ${report.browser?.passed ? "yes" : "no"}`,
    `browser_driver: ${report.browser?.driver || ""}`,
    `browser_checks: ${(report.browser?.checks || []).filter((check) => check.passed).length}/${(report.browser?.checks || []).length}`,
    `console_errors: ${(report.browser?.consoleErrors || []).length}`,
  ];
  for (const check of report.browser?.checks || []) {
    lines.push(`- ${check.passed ? "pass" : "fail"} ${check.key}: ${check.detail || ""}`);
  }
  if (report.files?.markdown) lines.push(`evidence_md: ${report.files.markdown}`);
  if (report.files?.json) lines.push(`evidence_json: ${report.files.json}`);
  if (report.error) lines.push(`error: ${report.error}`);
  return lines.map(redactRuntimeDbBrowserAcceptanceLine);
}

export async function runPlaywrightBrowserAcceptance({ baseUrl, credentials = {}, env = process.env } = {}) {
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    return {
      passed: false,
      driver: "missing-playwright",
      checks: [{
        key: "browser_driver",
        passed: false,
        detail: "Playwright is not available in this Node environment. Install/use a runtime with playwright to run rendered browser acceptance.",
      }],
      consoleErrors: [],
      screenshot: "",
    };
  }

  const executablePath = resolveChromiumExecutable(env);
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const consoleErrors = [];
  const checks = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60000 });
    if (await page.locator("text=Sign in to Matter Workbench").count()) {
      if (!credentials.username || !credentials.password) {
        checks.push({ key: "private_beta_login", passed: false, detail: "Login screen appeared but credentials were not provided." });
      } else {
        await page.locator('input[autocomplete="username"]').fill(credentials.username);
        await page.locator('input[autocomplete="current-password"]').fill(credentials.password);
        await page.locator('button[type="submit"]').click();
        await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
        await page.waitForFunction(
          () => !document.body.innerText.includes("Sign in to Matter Workbench"),
          null,
          { timeout: 60000 },
        );
        await page.waitForSelector('[aria-label="Workspace navigation"]', { timeout: 60000 });
        checks.push({ key: "private_beta_login", passed: true, detail: "Signed in through the React login screen." });
      }
    } else {
      checks.push({ key: "private_beta_login", passed: true, detail: "Private beta login was not required." });
    }

    const titleVisible = await page.locator("text=Matter Workbench").first().isVisible().catch(() => false);
    checks.push({ key: "react_root_loaded", passed: titleVisible, detail: titleVisible ? "React shell rendered." : "React shell title was not visible." });

    const matters = await page.evaluate(async () => {
      const response = await fetch("/api/matters");
      return response.ok ? await response.json() : { matters: [] };
    });
    const matterRows = Array.isArray(matters?.matters) ? matters.matters : [];
    checks.push({
      key: "runtime_db_matters_listed",
      passed: matterRows.length > 0,
      detail: matterRows.length ? `${matterRows.length} matter(s) listed from runtime DB.` : "No runtime DB matters were listed.",
    });

    if (matterRows.length) {
      const target = matterRows[0];
      const expectedMatterText = target.matterName || target.name;
      const switchResult = await page.evaluate(async (name) => {
        const response = await fetch("/api/switch-matter", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        });
        let payload = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        return { ok: response.ok, status: response.status, payload };
      }, expectedMatterText);
      await page.reload({ waitUntil: "networkidle", timeout: 60000 });
      await waitForReactShell(page);
      const activeMatterName = await page.evaluate(async () => {
        const response = await fetch("/api/matters");
        if (!response.ok) return "";
        const payload = await response.json();
        return payload.active || payload.activeMatter || "";
      }).catch(() => "");
      const activeMatterVisible = await textVisible(page, expectedMatterText);
      checks.push({
        key: "home_and_matter_navigation",
        passed: Boolean(
          switchResult?.ok
          && (activeMatterName === expectedMatterText || activeMatterVisible)
        ),
        detail: `Selected ${expectedMatterText}; active matter ${activeMatterName || "not reported"}.`,
      });

      const workspace = await page.evaluate(async () => {
        const response = await fetch("/api/workspace");
        return response.ok ? await response.json() : null;
      });
      const previewPath = firstPreviewableFilePath(workspace?.tree || workspace?.files || []);
      let previewReadable = false;
      if (previewPath) {
        const preview = await page.evaluate(async (pathName) => {
          const response = await fetch(`/api/file?${new URLSearchParams({ path: pathName })}`);
          return response.ok ? await response.json() : null;
        }, previewPath);
        previewReadable = typeof preview?.content === "string";
      }
      checks.push({
        key: "workspace_preview",
        passed: Boolean(previewPath && previewReadable),
        detail: previewPath ? `Previewed ${previewPath}.` : "No previewable DB-backed file was available.",
      });

      const attention = await page.evaluate(async () => {
        const response = await fetch("/api/matter-attention");
        return response.ok ? await response.json() : null;
      });
      checks.push({
        key: "advisory_visible",
        passed: Boolean(attention?.schema_version === "matter-attention/v1"),
        detail: attention?.schema_version || "Matter attention API was not readable from the browser context.",
      });
    }

    const activityNav = await clickAppNav(page, ["Activity", "Recent work"]);
    checks.push({
      key: "activity_receipts_visible",
      passed: Boolean(activityNav.clicked && await waitForHeading(page, "Activity")),
      detail: activityNav.clicked ? "Activity page opened." : activityNav.detail,
    });
    const settingsNav = await clickAppNav(page, "Settings", [
      'nav[aria-label="App navigation"]',
      '[aria-label="Account"]',
    ]);
    checks.push({
      key: "settings_visible",
      passed: Boolean(settingsNav.clicked && await waitForHeading(page, "Settings")),
      detail: settingsNav.clicked ? "Settings page opened." : settingsNav.detail,
    });
  } finally {
    await browser.close();
  }

  return {
    passed: checks.length > 0 && checks.every((check) => check.passed) && consoleErrors.length === 0,
    driver: "playwright",
    checks,
    consoleErrors: consoleErrors.map(redactRuntimeDbBrowserAcceptanceLine),
    screenshot: "",
  };
}

export function resolveChromiumExecutable(env = process.env) {
  const configured = String(env.MWB_PLAYWRIGHT_CHROMIUM_EXECUTABLE || "").trim();
  if (configured) return configured;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

export async function clickAppNav(page, labels, scopes = ['nav[aria-label="App navigation"]']) {
  await waitForReactShell(page);
  const labelList = Array.isArray(labels) ? labels : [labels];
  const scopeList = Array.isArray(scopes) ? scopes : [scopes];
  for (const selector of scopeList) {
    const nav = page.locator(selector);
    for (const text of labelList) {
      const candidate = nav.getByRole("button", { name: new RegExp(`\\b${escapeRegExp(text)}\\b`, "i") });
      if (await candidate.count()) {
        await candidate.first().click();
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(150);
        return { clicked: true, label: text, scope: selector };
      }
    }
  }
  return {
    clicked: false,
    label: "",
    detail: `Navigation item not found: ${labelList.join(" or ")} in ${scopeList.join(" or ")}`,
  };
}

async function waitForReactShell(page) {
  await page.waitForSelector('[aria-label="Workspace navigation"]', { timeout: 60000 });
  await page.waitForSelector('nav[aria-label="App navigation"] button', { timeout: 60000 });
}

async function textVisible(page, text) {
  return await page.locator(`text=${text}`).first().isVisible().catch(() => false);
}

async function waitForHeading(page, text) {
  return await page.getByRole("heading", { name: new RegExp(`^${escapeRegExp(text)}$`, "i") })
    .first()
    .waitFor({ state: "visible", timeout: 30000 })
    .then(() => true)
    .catch(() => false);
}

function firstPreviewableFilePath(treeOrNodes = []) {
  const nodes = Array.isArray(treeOrNodes)
    ? treeOrNodes
    : Array.isArray(treeOrNodes?.children)
      ? treeOrNodes.children
      : [];
  for (const node of nodes) {
    if (node?.kind === "file" && node.previewable && node.previewKind === "text" && node.path) return node.path;
    const childPath = firstPreviewableFilePath(node?.children || []);
    if (childPath) return childPath;
  }
  return "";
}

async function writeRuntimeDbBrowserAcceptanceEvidence({ report, packDir }) {
  const jsonPath = path.join(packDir, "runtime-db-browser-acceptance-pack.json");
  const markdownPath = path.join(packDir, "runtime-db-browser-acceptance-pack.md");
  const evidence = sanitizeEvidence({
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    passed: report.passed,
    runtimeDb: report.runtimeDb,
    writeSmoke: report.writeSmoke,
    browser: report.browser,
    error: report.error,
  });
  await writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${renderEvidenceMarkdown(evidence).join("\n")}\n`, "utf8");
  return { json: jsonPath, markdown: markdownPath };
}

function renderEvidenceMarkdown(evidence = {}) {
  const lines = [
    "# Runtime DB Browser Acceptance Pack",
    "",
    `Generated at: ${evidence.generatedAt || ""}`,
    `Passed: ${evidence.passed ? "yes" : "no"}`,
    "",
    "## Runtime DB",
    "",
    `- Enabled: ${evidence.runtimeDb?.enabled ? "yes" : "no"}`,
    `- Mode: ${evidence.runtimeDb?.mode || ""}`,
    `- Storage mode: ${evidence.runtimeDb?.storageMode || ""}`,
    `- Tenant: ${evidence.runtimeDb?.tenantId || ""}`,
    "",
    "## Write Smoke",
    "",
    `- Passed: ${evidence.writeSmoke?.passed ? "yes" : "no"}`,
    `- Role guard: ${evidence.writeSmoke?.roleGuardPassed ? "yes" : "no"}`,
    `- DB rows verified: ${evidence.writeSmoke?.dbRowsVerified ? "yes" : "no"}`,
    `- Cleanup deleted: ${evidence.writeSmoke?.cleanupDeleted ? "yes" : "no"}`,
    "",
    "## Browser Checks",
    "",
    `- Driver: ${evidence.browser?.driver || ""}`,
    `- Passed: ${evidence.browser?.passed ? "yes" : "no"}`,
    `- Console errors: ${(evidence.browser?.consoleErrors || []).length}`,
    "",
    "| Check | Result | Detail |",
    "|---|---|---|",
  ];
  for (const check of evidence.browser?.checks || []) {
    lines.push(`| ${escapeTable(check.key)} | ${check.passed ? "pass" : "fail"} | ${escapeTable(check.detail || "")} |`);
  }
  if (evidence.error) lines.push("", `Error: ${evidence.error}`);
  return lines.map(redactRuntimeDbBrowserAcceptanceLine);
}

function runtimeDbBrowserAcceptanceEnv(env = {}) {
  return {
    ...env,
    MWB_RUNTIME_DB: env.MWB_RUNTIME_DB || "postgres",
    MWB_RUNTIME_DB_STORAGE: env.MWB_RUNTIME_DB_STORAGE || "postgres",
    MWB_DB_RUNTIME_CUTOVER_APPROVED: env.MWB_DB_RUNTIME_CUTOVER_APPROVED || "yes",
  };
}

function privateBetaCredentials(env = {}) {
  const username = String(env.MWB_PRIVATE_BETA_USERNAME || "").trim();
  const password = String(env.MWB_PRIVATE_BETA_PASSWORD || "");
  return username || password ? { username, password } : {};
}

function sanitizeEvidence(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeEvidence(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeEvidence(item)]));
  }
  if (typeof value === "string") return redactRuntimeDbBrowserAcceptanceLine(value);
  return value;
}

function redactRuntimeDbBrowserAcceptanceLine(value) {
  return redactSensitiveText(String(value || ""))
    .replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@/g, "postgres://$1:***@")
    .replace(/\bsecret\b/gi, "***")
    .replace(/\bdb\.example\b/g, "[redacted-host]");
}

function timestampSlug(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, "-");
}

function escapeTable(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  await loadDatabaseScriptEnv();
  const args = parseRuntimeDbBrowserAcceptanceArgs(process.argv.slice(2));
  const report = await runRuntimeDbBrowserAcceptancePack(args);
  for (const line of renderRuntimeDbBrowserAcceptanceReport(report)) console.log(line);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactRuntimeDbBrowserAcceptanceLine(error.stack || error.message));
    process.exitCode = 1;
  });
}
