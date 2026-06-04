#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_WORKBENCH_BASE_URL } from "../shared/local-server-defaults.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

export async function runModeAAcceptance(options = {}) {
  const manifestPath = path.resolve(options.manifest || "");
  if (!manifestPath) throw new Error("--manifest is required");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const backupDir = path.dirname(manifestPath);
  const baseUrl = String(options.baseUrl || DEFAULT_WORKBENCH_BASE_URL).replace(/\/$/, "");
  const selected = selectMatters(manifest.matters || [], options);
  const reportPath = path.resolve(options.report || path.join(backupDir, "acceptance-report.json"));
  const report = {
    schema_version: "v1-beta-mode-a-acceptance-report/v1",
    generated_at: new Date().toISOString(),
    baseUrl,
    manifestPath,
    mattersHome: manifest.mattersHome,
    backupDir,
    matters: [],
  };

  for (const matter of selected) {
    const matterReport = {
      matterName: matter.matterName,
      started_at: new Date().toISOString(),
      finished_at: "",
      sourceFileCount: matter.sourceFiles?.length || 0,
      steps: [],
      artifacts: {},
      attention: null,
      status: "running",
    };
    report.matters.push(matterReport);
    await writeReport(reportPath, report);

    console.log(`\n== ${matter.matterName} ==`);
    await runStep(matterReport, "switch matter", () => postJson(baseUrl, "/api/switch-matter", { name: matter.matterName }));
    await runStep(matterReport, "upload source files", () => uploadSourceFiles({ baseUrl, backupDir, matter }));
    await runStep(matterReport, "prepare plan", () => getJson(baseUrl, "/api/prepare-matter"));
    await runStep(matterReport, "extract", () => postJson(baseUrl, "/api/extract", { dryRun: false }));
    await runStep(matterReport, "source labels", () => postJson(baseUrl, "/api/describe-sources", { dryRun: false }));
    await runStep(matterReport, "list of dates", () => postJson(baseUrl, "/api/create-listofdates", { dryRun: false }));
    await runStep(matterReport, "preview list of dates", () => getJson(baseUrl, `/api/file?path=${encodeURIComponent("10_Library/List of Dates.md")}`));
    await runStep(matterReport, "developer attention", async () => {
      const attention = await getJson(baseUrl, "/api/matter-attention");
      matterReport.attention = summarizeAttention(attention);
      return attention;
    });
    matterReport.artifacts = await summarizeArtifacts(matter.matterRoot);
    matterReport.finished_at = new Date().toISOString();
    matterReport.status = matterReport.steps.some((step) => step.status === "failed") ? "failed" : "passed";
    await writeReport(reportPath, report);
    console.log(`Result: ${matterReport.status}`);
  }

  report.finished_at = new Date().toISOString();
  report.summary = summarizeReport(report);
  await writeReport(reportPath, report);
  return report;
}

async function runStep(matterReport, name, fn) {
  const started = Date.now();
  const step = {
    name,
    status: "running",
    duration_ms: 0,
    summary: "",
    error: "",
  };
  matterReport.steps.push(step);
  console.log(`- ${name}...`);
  try {
    const result = await fn();
    step.status = "passed";
    step.summary = summarizeStepResult(name, result);
    console.log(`  ok ${step.summary}`);
    return result;
  } catch (error) {
    step.status = "failed";
    step.error = error?.message || String(error);
    console.log(`  failed ${step.error}`);
    return null;
  } finally {
    step.duration_ms = Date.now() - started;
  }
}

async function uploadSourceFiles({ baseUrl, backupDir, matter }) {
  const sourceFiles = matter.sourceFiles || [];
  if (!sourceFiles.length) throw new Error("No source files in reset manifest");
  const form = new FormData();
  form.append("label", "Initial");
  form.append("paths", JSON.stringify(sourceFiles.map((file) => file.importRelativePath)));
  for (const file of sourceFiles) {
    const absolutePath = path.join(backupDir, file.backupRelativePath);
    const bytes = await readFile(absolutePath);
    form.append("files", new Blob([bytes]), path.basename(file.importRelativePath));
  }
  return fetchJson(`${baseUrl}/api/matters/add-files`, {
    method: "POST",
    body: form,
    timeoutMs: 10 * 60 * 1000,
  });
}

async function summarizeArtifacts(matterRoot) {
  const sourceIndex = await readJsonSummary(path.join(matterRoot, "10_Library", "Source Index.json"), (json) => ({
    schema_version: json.schema_version || "",
    source_count: Array.isArray(json.sources) ? json.sources.length : 0,
    warning_count: Array.isArray(json.warnings) ? json.warnings.length : 0,
    provider: json.ai_run?.provider || "",
    model: json.ai_run?.model || "",
  }));
  const listJson = await readJsonSummary(path.join(matterRoot, "10_Library", "List of Dates.json"), (json) => ({
    schema_version: json.schema_version || "",
    entry_count: Array.isArray(json.entries) ? json.entries.length : 0,
    source_record_count: json.source_record_count || 0,
    provider: json.ai_run?.provider || "",
    model: json.ai_run?.model || "",
  }));
  return {
    sourceIndex,
    listOfDatesJson: listJson,
    listOfDatesMarkdown: await fileSummary(path.join(matterRoot, "10_Library", "List of Dates.md")),
    listOfDatesCsv: await fileSummary(path.join(matterRoot, "10_Library", "List of Dates.csv")),
  };
}

async function readJsonSummary(filePath, summarize) {
  try {
    const fileStat = await stat(filePath);
    const json = JSON.parse(await readFile(filePath, "utf8"));
    return { exists: true, bytes: fileStat.size, ...summarize(json) };
  } catch (error) {
    return { exists: false, error: error?.code === "ENOENT" ? "" : error?.message || String(error) };
  }
}

async function fileSummary(filePath) {
  try {
    const fileStat = await stat(filePath);
    return { exists: true, bytes: fileStat.size };
  } catch (error) {
    return { exists: false, error: error?.code === "ENOENT" ? "" : error?.message || String(error) };
  }
}

function summarizeAttention(attention) {
  const summary = attention?.summary || {};
  return {
    state: summary.state || "",
    total: summary.total || 0,
    blocker: summary.blocker || 0,
    warning: summary.warning || 0,
    info: summary.info || 0,
    codes: Array.isArray(attention?.items) ? [...new Set(attention.items.map((item) => item.code || "").filter(Boolean))] : [],
  };
}

function summarizeStepResult(name, result) {
  if (!result || typeof result !== "object") return "";
  if (name === "upload source files") {
    const added = result.intakeAdded || {};
    return `${added.scanned || 0} scanned, ${added.unique || 0} unique`;
  }
  if (name === "extract") {
    const counts = result.counts || {};
    return `${counts.extracted || 0} extracted, ${counts.cached || 0} cached, ${counts.failed || 0} failed`;
  }
  if (name === "source labels") {
    const sources = Array.isArray(result.sources) ? result.sources.length : result.described || 0;
    const warnings = Array.isArray(result.warnings) ? result.warnings.length : 0;
    return `${sources} sources, ${warnings} warning(s)`;
  }
  if (name === "list of dates") {
    const entries = Array.isArray(result.entries) ? result.entries.length : result.entryCount || 0;
    return `${entries} entries`;
  }
  if (name === "preview list of dates") {
    return result.kind || result.type || "preview loaded";
  }
  if (name === "developer attention") {
    const summary = result.summary || {};
    return `${summary.state || "unknown"} ${summary.total || 0} item(s)`;
  }
  return "";
}

async function getJson(baseUrl, pathWithQuery) {
  return requestJson(`${baseUrl}${pathWithQuery}`, { method: "GET", timeoutMs: 10 * 60 * 1000 });
}

async function postJson(baseUrl, route, body) {
  return requestJson(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 20 * 60 * 1000,
  });
}

async function requestJson(url, { timeoutMs = 300000, method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const requestBody = body === null || body === undefined ? null : Buffer.from(String(body));
    const request = client.request(parsed, {
      method,
      headers: {
        ...headers,
        ...(requestBody ? { "content-length": requestBody.length } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsedBody = null;
        try {
          parsedBody = text ? JSON.parse(text) : null;
        } catch {
          parsedBody = { raw: text.slice(0, 1000) };
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(parsedBody?.error || parsedBody?.message || `HTTP ${response.statusCode}`));
          return;
        }
        resolve(parsedBody);
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    request.on("error", reject);
    if (requestBody) request.write(requestBody);
    request.end();
  });
}

async function fetchJson(url, { timeoutMs = 300000, ...options } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 1000) };
    }
    if (!response.ok) {
      throw new Error(body?.error || body?.message || `HTTP ${response.status}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function selectMatters(matters, options = {}) {
  if (options.matterNames?.length) {
    const wanted = new Set(options.matterNames);
    const missing = [...wanted].filter((name) => !matters.some((matter) => matter.matterName === name));
    if (missing.length) throw new Error(`Matter(s) missing from manifest: ${missing.join(", ")}`);
    return matters.filter((matter) => wanted.has(matter.matterName));
  }
  return matters;
}

function summarizeReport(report) {
  const summary = {
    total: report.matters.length,
    passed: 0,
    failed: 0,
  };
  for (const matter of report.matters) {
    if (matter.status === "passed") summary.passed += 1;
    if (matter.status === "failed") summary.failed += 1;
  }
  return summary;
}

async function writeReport(reportPath, report) {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_WORKBENCH_BASE_URL,
    manifest: "",
    matterNames: [],
    report: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") options.baseUrl = requireValue(argv, ++index, arg);
    else if (arg === "--manifest") options.manifest = requireValue(argv, ++index, arg);
    else if (arg === "--matter") options.matterNames.push(requireValue(argv, ++index, arg));
    else if (arg === "--report") options.report = requireValue(argv, ++index, arg);
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function printHelp() {
  console.log([
    "Usage: node scripts/v1-beta-mode-a-acceptance.mjs --manifest <reset-manifest.json> [options]",
    "",
    "Options:",
    `  --base-url <url>     Running app URL. Default: ${DEFAULT_WORKBENCH_BASE_URL}`,
    "  --matter <name>      Run one named matter from the manifest. Repeatable.",
    "  --report <path>      Output JSON report path.",
    "  --help               Show help.",
  ].join("\n"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const options = parseArgs(process.argv.slice(2));
  runModeAAcceptance(options)
    .then((report) => {
      console.log(`\nAcceptance complete: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed`);
    })
    .catch((error) => {
      console.error(error?.stack || error?.message || error);
      process.exitCode = 1;
    });
}
