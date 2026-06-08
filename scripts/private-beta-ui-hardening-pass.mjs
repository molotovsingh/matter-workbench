#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { redactSensitiveText } from "../shared/secret-redaction.mjs";
import { loadDatabaseScriptEnv } from "./db-env.mjs";
import { resolveChromiumExecutable } from "./runtime-db-browser-acceptance-pack.mjs";

const __filename = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const SCHEMA_VERSION = "private-beta-ui-hardening-pass/v1";
const DEFAULT_OUT_DIR = path.resolve(".local", "private-beta-ui-hardening-passes");

export function parsePrivateBetaUiHardeningArgs(argv = [], env = process.env) {
  const parsed = {
    outDir: DEFAULT_OUT_DIR,
    timestamp: "",
    baseUrl: (env.MWB_PRIVATE_VM_BASE_URL || env.MWB_PRIVATE_BETA_PUBLIC_URL || "http://127.0.0.1:4191").replace(/\/+$/, ""),
    authUsername: env.MWB_PRIVATE_BETA_USERNAME || "",
    authPassword: env.MWB_PRIVATE_BETA_PASSWORD || "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      parsed.outDir = path.resolve(requiredValue(argv, i, arg));
      i += 1;
    } else if (arg === "--timestamp") {
      parsed.timestamp = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--base-url") {
      parsed.baseUrl = requiredValue(argv, i, arg).replace(/\/+$/, "");
      i += 1;
    } else if (arg === "--auth-username") {
      parsed.authUsername = requiredValue(argv, i, arg);
      i += 1;
    } else if (arg === "--auth-password") {
      parsed.authPassword = requiredValue(argv, i, arg);
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function runPrivateBetaUiHardeningPass({
  outDir = DEFAULT_OUT_DIR,
  timestamp = new Date().toISOString(),
  baseUrl = "http://127.0.0.1:4191",
  authUsername = "",
  authPassword = "",
  browserCheckFn = runRenderedUiChecks,
} = {}) {
  const generatedAt = timestamp || new Date().toISOString();
  const slug = timestampSlug(generatedAt);
  const packDir = path.join(outDir, `private-beta-ui-hardening-${slug}`);
  await mkdir(packDir, { recursive: true });

  let browser = {
    passed: false,
    driver: "",
    checks: [],
    consoleErrors: [],
    screenshots: [],
    error: "",
  };
  try {
    browser = await browserCheckFn({
      baseUrl: baseUrl.replace(/\/+$/, ""),
      authUsername,
      authPassword,
      screenshotDir: packDir,
      generatedAt,
      env: process.env,
    });
  } catch (error) {
    browser = {
      passed: false,
      driver: "exception",
      checks: [],
      consoleErrors: [],
      screenshots: [],
      error: error?.message || "rendered UI hardening pass failed",
    };
  }

  const sanitizedBrowser = sanitizeEvidence(normalizeBrowserResult(browser));
  const failedChecks = [];
  for (const check of sanitizedBrowser.checks) {
    if (!check.passed) failedChecks.push(check.key || "unnamed_check");
  }
  if (sanitizedBrowser.consoleErrors.length > 0) failedChecks.push("console_errors");
  if (sanitizedBrowser.error) failedChecks.push("browser_exception");

  const result = sanitizeEvidence({
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    success: failedChecks.length === 0 && Boolean(sanitizedBrowser.passed),
    baseUrl: baseUrl.replace(/\/+$/, ""),
    failedChecks,
    browser: sanitizedBrowser,
    files: {},
  });
  result.files = await writeUiHardeningEvidence({ result, packDir });
  return result;
}

export function renderPrivateBetaUiHardeningPassResult(result = {}) {
  const checks = Array.isArray(result.browser?.checks) ? result.browser.checks : [];
  const passed = checks.filter((check) => check.passed).length;
  const lines = [
    "Matter Workbench private beta UI hardening pass",
    `success: ${result.success ? "yes" : "no"}`,
    `generated_at: ${result.generatedAt || ""}`,
    `base_url: ${result.baseUrl || ""}`,
    `driver: ${result.browser?.driver || ""}`,
    `checks: ${passed}/${checks.length}`,
    `console_errors: ${(result.browser?.consoleErrors || []).length}`,
  ];
  if (result.failedChecks?.length) lines.push(`failed_checks: ${result.failedChecks.join(", ")}`);
  if (result.files?.markdown) lines.push(`evidence_md: ${result.files.markdown}`);
  if (result.files?.json) lines.push(`evidence_json: ${result.files.json}`);
  if (result.browser?.error) lines.push(`error: ${result.browser.error}`);
  return lines.map(redactLine);
}

export async function runRenderedUiChecks({
  baseUrl = "http://127.0.0.1:4191",
  authUsername = "",
  authPassword = "",
  screenshotDir = ".",
  env = process.env,
} = {}) {
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
        detail: "Playwright is not available. Run npm install or use a deployment with project dev dependencies installed.",
      }],
      consoleErrors: [],
      screenshots: [],
    };
  }

  const executablePath = resolveChromiumExecutable(env);
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const checks = [];
  const consoleErrors = [];
  const screenshots = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60000 });
    await loginIfRequired(page, { authUsername, authPassword, checks });
    await waitForHomeSurface(page);

    await page.waitForSelector("body", { timeout: 60000 });
    checks.push(await bodyIncludesCheck(page, "home_shell", ["Matter Workbench", "What do you need?"], "Home shell and command rail rendered."));
    checks.push(await homeMatterStateCheck(page));
    checks.push(await bodyIncludesCheck(page, "feedback_entry_visible", ["Have a problem? Tell us what happened"], "Feedback entry is visible in the command rail."));
    checks.push(await copilotTierCheck(page));
    checks.push(await feedbackEndpointCheck(page));
    screenshots.push(await takeScreenshot(page, screenshotDir, "home_desktop", "home-desktop.png"));

    await openActivityTab(page, "Skills");
    checks.push(await bodyIncludesCheck(page, "skills_page", ["Skills", "Your Skills", "Built-in Workflows"], "Skills page loaded with simplified sections."));
    screenshots.push(await takeScreenshot(page, screenshotDir, "skills_desktop", "skills-desktop.png"));

    await openActivityTab(page, "Activity");
    checks.push(await bodyIncludesCheck(page, "activity_page", ["Activity"], "Activity page loaded."));
    screenshots.push(await takeScreenshot(page, screenshotDir, "activity_desktop", "activity-desktop.png"));

    await openActivityTab(page, "Settings");
    checks.push(await bodyIncludesCheck(page, "settings_page", ["Settings"], "Settings page loaded."));
    checks.push(await settingsSecretScanCheck(page));
    screenshots.push(await takeScreenshot(page, screenshotDir, "settings_desktop", "settings-desktop.png"));

    await page.setViewportSize({ width: 390, height: 860 });
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60000 });
    await loginIfRequired(page, { authUsername, authPassword, checks });
    await waitForHomeSurface(page);
    checks.push(await mobileOverflowCheck(page));
    screenshots.push(await takeScreenshot(page, screenshotDir, "home_mobile", "home-mobile.png"));
  } finally {
    await browser.close();
  }

  return {
    passed: checks.length > 0 && checks.every((check) => check.passed) && consoleErrors.length === 0,
    driver: "playwright",
    checks,
    consoleErrors: consoleErrors.map(redactLine),
    screenshots,
  };
}

export async function waitForHomeSurface(page) {
  await page.waitForSelector("text=What do you need?", { timeout: 60000 });
  await page.waitForSelector("body", { timeout: 60000 });
}

async function loginIfRequired(page, { authUsername = "", authPassword = "", checks = [] } = {}) {
  const loginVisible = await page.locator("text=Sign in to Matter Workbench").first().isVisible().catch(() => false);
  if (!loginVisible) return;
  if (!authUsername || !authPassword) {
    checks.push({ key: "private_beta_login", passed: false, detail: "Login screen appeared but credentials were not provided." });
    return;
  }
  await page.locator('input[autocomplete="username"]').fill(authUsername);
  await page.locator('input[autocomplete="current-password"]').fill(authPassword);
  await page.locator('button[type="submit"]').click();
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForSelector("text=Matter Workbench", { timeout: 60000 });
  checks.push({ key: "private_beta_login", passed: true, detail: "Signed in through the private beta login screen." });
}

async function bodyIncludesCheck(page, key, requiredTexts, detail) {
  const body = await page.locator("body").innerText({ timeout: 60000 }).catch(() => "");
  const missing = requiredTexts.filter((text) => !body.toLowerCase().includes(String(text).toLowerCase()));
  return {
    key,
    passed: missing.length === 0,
    detail: missing.length ? `Missing visible text: ${missing.join(", ")}` : detail,
  };
}

export async function homeMatterStateCheck(page) {
  const body = await page.locator("body").innerText({ timeout: 60000 }).catch(() => "");
  const lower = body.toLowerCase();
  const hasMatterPicker = lower.includes("available matters");
  const hasActiveMatter = lower.includes("files loaded from the matter folder");
  return {
    key: "matters_or_active_matter",
    passed: hasMatterPicker || hasActiveMatter,
    detail: hasMatterPicker
      ? "Home shows the matter picker."
      : hasActiveMatter
        ? "Home shows an active matter overview."
        : "Home shows neither the matter picker nor an active matter overview.",
  };
}

async function copilotTierCheck(page) {
  const options = await page.locator('select[aria-label="Copilot strength"] option').evaluateAll((nodes) => nodes.map((node) => node.textContent || "")).catch(() => []);
  const labels = options.map((item) => String(item).trim());
  const missing = ["Low", "Medium", "High"].filter((label) => !labels.includes(label));
  return {
    key: "copilot_tiers_visible",
    passed: missing.length === 0,
    detail: missing.length ? `Missing Copilot tier option(s): ${missing.join(", ")}` : `Copilot tiers available: ${labels.join(", ")}.`,
  };
}

async function feedbackEndpointCheck(page) {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/private-beta/feedback?limit=5");
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, schema: body.schema_version || "" };
  }).catch((error) => ({ ok: false, status: 0, schema: "", error: error?.message || "feedback endpoint check failed" }));
  return {
    key: "feedback_endpoint_readable",
    passed: Boolean(result.ok && result.schema === "private-beta-feedback-ledger/v1"),
    detail: result.ok ? `Feedback endpoint returned ${result.schema}.` : `Feedback endpoint failed with ${result.status || "unknown status"}${result.error ? `: ${result.error}` : ""}.`,
  };
}

async function settingsSecretScanCheck(page) {
  const body = await page.locator("body").innerText({ timeout: 60000 }).catch(() => "");
  const leaked = secretLeakPatterns().filter((pattern) => pattern.test(body));
  return {
    key: "settings_secret_leak",
    passed: leaked.length === 0,
    detail: leaked.length ? "Settings page contains secret-looking text." : "Settings page did not expose secret-looking values.",
  };
}

async function mobileOverflowCheck(page) {
  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  })).catch(() => ({ innerWidth: 0, scrollWidth: 0, bodyScrollWidth: 0 }));
  const maxScrollWidth = Math.max(dimensions.scrollWidth || 0, dimensions.bodyScrollWidth || 0);
  const overflowPx = maxScrollWidth - (dimensions.innerWidth || 0);
  return {
    key: "mobile_overflow",
    passed: overflowPx <= 8,
    detail: overflowPx <= 8 ? "Narrow viewport has no meaningful horizontal overflow." : `Narrow viewport overflows by ${overflowPx}px.`,
  };
}

async function openActivityTab(page, label) {
  const button = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(label)}$`, "i") });
  if (await button.count()) {
    await button.first().click();
  } else {
    await page.locator(`text=${label}`).first().click();
  }
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(250);
}

async function takeScreenshot(page, screenshotDir, label, filename) {
  const screenshotPath = path.join(screenshotDir, filename);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return { label, path: screenshotPath };
}

async function writeUiHardeningEvidence({ result, packDir }) {
  const jsonPath = path.join(packDir, "ui-hardening-report.json");
  const markdownPath = path.join(packDir, "ui-hardening-report.md");
  const evidence = sanitizeEvidence({
    schemaVersion: result.schemaVersion,
    generatedAt: result.generatedAt,
    success: result.success,
    baseUrl: result.baseUrl,
    failedChecks: result.failedChecks,
    browser: result.browser,
  });
  await writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${renderEvidenceMarkdown(evidence).join("\n")}\n`, "utf8");
  return { json: jsonPath, markdown: markdownPath };
}

function renderEvidenceMarkdown(evidence = {}) {
  const checks = Array.isArray(evidence.browser?.checks) ? evidence.browser.checks : [];
  const lines = [
    "# Private Beta UI Hardening Pass",
    "",
    `Generated at: ${evidence.generatedAt || ""}`,
    `Base URL: ${evidence.baseUrl || ""}`,
    `Success: ${evidence.success ? "yes" : "no"}`,
    `Driver: ${evidence.browser?.driver || ""}`,
    `Console errors: ${(evidence.browser?.consoleErrors || []).length}`,
    "",
    "## Browser Checks",
    "",
    "| Check | Result | Detail |",
    "|---|---|---|",
  ];
  for (const check of checks) {
    lines.push(`| ${escapeTable(check.key)} | ${check.passed ? "pass" : "fail"} | ${escapeTable(check.detail || "")} |`);
  }
  if (evidence.browser?.consoleErrors?.length) {
    lines.push("", "## Console Errors", "");
    for (const error of evidence.browser.consoleErrors) lines.push(`- ${error}`);
  }
  if (evidence.browser?.screenshots?.length) {
    lines.push("", "## Screenshots", "");
    for (const screenshot of evidence.browser.screenshots) {
      lines.push(`- ${screenshot.label}: ${screenshot.path}`);
    }
  }
  if (evidence.failedChecks?.length) {
    lines.push("", `Failed checks: ${evidence.failedChecks.join(", ")}`);
  }
  if (evidence.browser?.error) lines.push("", `Error: ${evidence.browser.error}`);
  return lines.map(redactLine);
}

function normalizeBrowserResult(browser = {}) {
  return {
    passed: Boolean(browser.passed),
    driver: browser.driver || "",
    checks: Array.isArray(browser.checks)
      ? browser.checks.map((check) => ({
        key: String(check.key || ""),
        passed: Boolean(check.passed),
        detail: String(check.detail || ""),
      }))
      : [],
    consoleErrors: Array.isArray(browser.consoleErrors)
      ? browser.consoleErrors.map((error) => String(error || ""))
      : [],
    screenshots: Array.isArray(browser.screenshots)
      ? browser.screenshots.map((screenshot) => ({
        label: String(screenshot.label || ""),
        path: String(screenshot.path || ""),
      }))
      : [],
    error: browser.error || "",
  };
}

function sanitizeEvidence(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeEvidence(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeEvidence(item)]));
  }
  if (typeof value === "string") return redactLine(value);
  return value;
}

function redactLine(value) {
  return redactSensitiveText(String(value || ""))
    .replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@/gi, "postgres://$1:***@")
    .replace(/\b(AIza[0-9A-Za-z_-]{10,})\b/g, "[redacted-secret]")
    .replace(/\bsecret\b/gi, "***");
}

function secretLeakPatterns() {
  return [
    /\bsk-[A-Za-z0-9_-]+/,
    /\bAIza[0-9A-Za-z_-]{10,}/,
    /postgres:\/\/[^:@/\s]+:[^@/\s]+@/i,
    /\b(OPENAI_API_KEY|OPENROUTER_API_KEY|MISTRAL_API_KEY|GEMINI_API_KEY)\s*=/i,
    /\bBearer\s+[A-Za-z0-9._-]+/i,
  ];
}

function requiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value) throw new Error(`${option} requires a value`);
  return value;
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
  const args = parsePrivateBetaUiHardeningArgs(process.argv.slice(2));
  const result = await runPrivateBetaUiHardeningPass(args);
  for (const line of renderPrivateBetaUiHardeningPassResult(result)) console.log(line);
  if (!result.success) process.exitCode = 1;
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(redactLine(error.stack || error.message));
    process.exitCode = 1;
  });
}
