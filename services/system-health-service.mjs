import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import { parseEnvText } from "../shared/local-env.mjs";
import { redactSensitiveText, redactSensitiveValues } from "../shared/secret-redaction.mjs";

export const SYSTEM_HEALTH_SCHEMA_VERSION = "system-health/v1";

const DEFAULT_RECENT_LIMIT = 50;
const STATUS_RANK = Object.freeze({ ok: 0, warning: 1, error: 2 });
const DEFAULT_TASK_SAMPLE_LIMIT = 8;

export function createSystemHealthService({
  appDir = process.cwd(),
  aiSettingsService,
  commandInteractionLogService,
  configService,
  env = process.env,
  jobStatusService,
  matterStore,
  privateBetaObservabilityService,
  runtimeDbStorageService,
  now = () => new Date(),
  fsAccess = access,
  fsReadFile = readFile,
} = {}) {
  const root = path.resolve(appDir || process.cwd());

  async function readSystemHealth({ recentLimit = DEFAULT_RECENT_LIMIT } = {}) {
    const checks = [];
    const runtimeStorageMode = runtimeStorageModeLabel({ matterStore, runtimeDbStorageService });
    checks.push(...await configurationChecks({ runtimeStorageMode }));
    checks.push(...providerChecks());
    checks.push(...await runtimeChecks({ recentLimit }));
    checks.push(...await storageChecks({ runtimeStorageMode }));

    const status = aggregateStatus(checks);
    return {
      schema_version: SYSTEM_HEALTH_SCHEMA_VERSION,
      generatedAt: now().toISOString(),
      status,
      summary: summarizeChecks(checks),
      runtime: {
        storageMode: runtimeStorageMode,
        nodeVersion: process.version,
        appDir: root,
      },
      checks,
      recommendations: recommendationsForChecks(checks),
    };
  }

  return { readSystemHealth };

  async function configurationChecks({ runtimeStorageMode }) {
    const checks = [];
    const mattersHome = configService?.getMattersHome?.() || "";
    const runtimeDbMode = runtimeStorageMode === "postgres";
    if (mattersHome) {
      checks.push(check({
        id: "config.matters_home_configured",
        category: "configuration",
        label: "Matters home configured",
        status: "ok",
        message: "A matters home path is configured.",
        detail: safePath(mattersHome),
      }));
      checks.push(await pathAccessCheck({
        id: "config.matters_home_readable",
        category: "configuration",
        label: "Matters home readable",
        targetPath: mattersHome,
        mode: fsConstants.R_OK,
        okMessage: "Matters home is readable.",
        failMessage: "Matters home cannot be read.",
      }));
      checks.push(await pathAccessCheck({
        id: "config.matters_home_writable",
        category: "configuration",
        label: "Matters home writable",
        targetPath: mattersHome,
        mode: fsConstants.W_OK,
        okMessage: "Matters home is writable.",
        failMessage: "Matters home is not writable; uploads and generated artifacts may fail.",
      }));
    } else if (runtimeDbMode) {
      checks.push(check({
        id: "config.matters_home_configured",
        category: "configuration",
        label: "Matters home configured",
        status: "ok",
        message: "Runtime DB storage is enabled, so a local matters folder is optional.",
      }));
    } else {
      checks.push(check({
        id: "config.matters_home_configured",
        category: "configuration",
        label: "Matters home configured",
        status: "error",
        message: "No matters home is configured.",
        recommendation: "Open Settings and choose a matters folder before starting beta work.",
      }));
    }

    checks.push(await envFileCheck());
    checks.push(check({
      id: "config.public_secret_exposure",
      category: "configuration",
      label: "Public config secret exposure",
      status: "ok",
      message: "Config and AI settings expose only booleans/model labels, not API key values.",
    }));
    return checks;
  }

  function providerChecks() {
    const checks = [];
    let settings = null;
    try {
      settings = aiSettingsService?.readSettings?.() || null;
    } catch (error) {
      checks.push(check({
        id: "provider.settings_readable",
        category: "provider",
        label: "AI settings readable",
        status: "error",
        message: `AI settings could not be read: ${safeMessage(error)}`,
      }));
      return checks;
    }
    checks.push(check({
      id: "provider.settings_readable",
      category: "provider",
      label: "AI settings readable",
      status: "ok",
      message: "AI task routing settings resolved without throwing.",
    }));

    const tasks = Array.isArray(settings?.aiTasks) ? settings.aiTasks : [];
    const notReady = tasks.filter((task) => !task.ready);
    checks.push(check({
      id: "provider.routes_ready",
      category: "provider",
      label: "Provider routes ready",
      status: notReady.length ? "warning" : "ok",
      message: notReady.length
        ? `${notReady.length} provider-backed task route${notReady.length === 1 ? "" : "s"} need setup.`
        : "Provider-backed task routes have configured keys and models.",
      evidence: notReady.slice(0, DEFAULT_TASK_SAMPLE_LIMIT).map((task) => ({
        task: task.task,
        label: task.label,
        provider: task.provider,
        model: task.model,
        note: redactSensitiveText(task.note || ""),
      })),
      recommendation: notReady.length ? "Configure missing provider keys/models in Settings before supervised beta work." : "",
    }));

    const startupCopilotCheck = settings?.startupChecks?.copilot;
    if (startupCopilotCheck) {
      checks.push(check({
        id: "provider.copilot_startup_check",
        category: "provider",
        label: "Matter Copilot startup check",
        status: startupCopilotCheck.ok ? "ok" : "warning",
        message: startupCopilotCheck.ok
          ? `Matter Copilot model check passed for ${startupCopilotCheck.provider || "unknown"} / ${startupCopilotCheck.model || "unknown"}.`
          : `Matter Copilot model check failed for ${startupCopilotCheck.provider || "unknown"} / ${startupCopilotCheck.model || "unknown"}: ${safeMessage(startupCopilotCheck.error)}`,
        evidence: [{
          provider: startupCopilotCheck.provider || "",
          model: startupCopilotCheck.model || "",
          checkedAt: startupCopilotCheck.checkedAt || "",
          latencyMs: startupCopilotCheck.latencyMs || 0,
          code: startupCopilotCheck.code || "",
        }],
        recommendation: startupCopilotCheck.ok ? "" : "Fix the Copilot key/model route before tester sessions that rely on Copilot.",
      }));
    }

    const failClosedProblems = tasks.filter((task) => task.fallback === "fail_closed" && !task.ready);
    checks.push(check({
      id: "provider.fail_closed_routes",
      category: "provider",
      label: "Fail-closed route posture",
      status: failClosedProblems.length ? "warning" : "ok",
      message: failClosedProblems.length
        ? "Some fail-closed provider routes are not ready and will block their workflow instead of silently falling back."
        : "Fail-closed provider routes are either ready or not required by current settings.",
      evidence: failClosedProblems.slice(0, DEFAULT_TASK_SAMPLE_LIMIT).map((task) => ({ task: task.task, label: task.label, note: redactSensitiveText(task.note || "") })),
    }));
    return checks;
  }

  async function runtimeChecks({ recentLimit }) {
    const checks = [];
    checks.push(check({
      id: "runtime.server_process",
      category: "runtime",
      label: "Server process",
      status: "ok",
      message: "System health endpoint is responding from the current server process.",
    }));

    const jobs = await safeReadJobs(recentLimit);
    if (jobs.error) {
      checks.push(check({
        id: "runtime.job_ledger_readable",
        category: "runtime",
        label: "Job ledger readable",
        status: "warning",
        message: `Recent job ledger could not be read: ${jobs.error}`,
      }));
    } else {
      const failures = jobs.items.filter((job) => job.status === "failed");
      const providerFailures = failures.filter((job) => /provider|openai|openrouter|api key|quota|auth/i.test(`${job.errorMessage || ""} ${job.errorCode || ""} ${job.failureClass || ""}`));
      checks.push(check({
        id: "runtime.recent_job_failures",
        category: "runtime",
        label: "Recent job failures",
        status: providerFailures.length >= 3 || failures.length >= 8 ? "warning" : "ok",
        message: failures.length
          ? `${failures.length} failed job${failures.length === 1 ? "" : "s"} in the recent ledger.`
          : "No failed jobs in the recent ledger.",
        evidence: failures.slice(0, DEFAULT_TASK_SAMPLE_LIMIT).map((job) => ({
          id: job.id,
          kind: job.kind,
          matterName: job.matterName,
          errorCode: job.errorCode,
          failureClass: job.failureClass,
          stage: job.metadata?.workflow?.stage,
          route: job.metadata?.workflow?.route,
          errorMessage: redactSensitiveText(job.errorMessage || ""),
        })),
        recommendation: providerFailures.length >= 3 ? "Check provider credentials/quotas before treating failures as matter-specific." : "",
      }));
    }

    const interactions = await safeReadInteractions(recentLimit);
    if (interactions.error) {
      checks.push(check({
        id: "runtime.command_log_readable",
        category: "runtime",
        label: "Command log readable",
        status: "warning",
        message: `Recent command interaction log could not be read: ${interactions.error}`,
      }));
    } else {
      const failedInteractions = interactions.items.filter((entry) => Array.isArray(entry.errors) && entry.errors.length);
      checks.push(check({
        id: "runtime.recent_command_failures",
        category: "runtime",
        label: "Recent command failures",
        status: failedInteractions.length >= 5 ? "warning" : "ok",
        message: failedInteractions.length
          ? `${failedInteractions.length} recent command interaction${failedInteractions.length === 1 ? "" : "s"} recorded errors.`
          : "No recent command interaction errors were recorded.",
        evidence: failedInteractions.slice(0, DEFAULT_TASK_SAMPLE_LIMIT).map((entry) => ({
          timestamp: entry.timestamp,
          matterName: entry.matter?.matter_name || entry.matter?.matterName || "",
          matchedCommand: entry.matched_command || entry.matchedCommand || "",
          errors: (entry.errors || []).map((value) => redactSensitiveText(String(value || ""))).slice(0, 2),
        })),
      }));
    }

    const observability = await safeReadPrivateBetaObservability(recentLimit);
    if (observability.available) {
      if (observability.error) {
        checks.push(check({
          id: "runtime.private_beta_observability_ledgers",
          category: "runtime",
          label: "Private beta observability ledgers",
          status: "warning",
          message: `Private beta observability could not be read: ${observability.error}`,
        }));
      } else {
        const ledgerErrors = Array.isArray(observability.report?.ledgerErrors) ? observability.report.ledgerErrors : [];
        checks.push(check({
          id: "runtime.private_beta_observability_ledgers",
          category: "runtime",
          label: "Private beta observability ledgers",
          status: ledgerErrors.length ? "warning" : "ok",
          message: ledgerErrors.length
            ? `${ledgerErrors.length} private beta observability ledger${ledgerErrors.length === 1 ? "" : "s"} could not be read.`
            : "Private beta observability ledgers are readable.",
          evidence: ledgerErrors.slice(0, DEFAULT_TASK_SAMPLE_LIMIT).map((entry) => ({
            source: entry.source,
            message: redactSensitiveText(String(entry.message || "")),
          })),
          recommendation: ledgerErrors.length ? "Check private beta feedback/signal/metrics/heartbeat ledger paths before relying on telemetry retry evidence." : "",
        }));
      }
    }
    return checks;
  }

  async function storageChecks({ runtimeStorageMode }) {
    const checks = [];
    const runtimeDbStorageReady = runtimeStorageMode !== "postgres" || runtimeDbStorageService?.enabled === true;
    checks.push(check({
      id: "storage.workspace_mode",
      category: "storage",
      label: "Workspace storage mode",
      status: runtimeDbStorageReady ? "ok" : "error",
      message: runtimeStorageMode === "postgres"
        ? (runtimeDbStorageReady ? "Runtime DB workspace storage is configured." : "Runtime DB workspace mode is selected, but storage is not configured.")
        : "Filesystem workspace storage is active.",
      recommendation: runtimeDbStorageReady ? "" : "Set the runtime database URL and tenant before running runtime DB beta sessions.",
    }));
    const localDir = path.join(root, ".local");
    checks.push(await pathAccessCheck({
      id: "storage.local_dir_readable",
      category: "storage",
      label: "App local store readable",
      targetPath: localDir,
      mode: fsConstants.R_OK,
      missingStatus: "warning",
      okMessage: ".local store directory is readable.",
      failMessage: ".local store directory is not readable or does not exist yet.",
    }));
    checks.push(await pathAccessCheck({
      id: "storage.local_dir_writable",
      category: "storage",
      label: "App local store writable",
      targetPath: localDir,
      mode: fsConstants.W_OK,
      missingStatus: "warning",
      okMessage: ".local store directory is writable.",
      failMessage: ".local store directory is not writable or does not exist yet.",
    }));

    const matterScan = await safeListMatterChildren();
    checks.push(check({
      id: "storage.matter_scan",
      category: "storage",
      label: "Matter list scan",
      status: matterScan.error ? "warning" : "ok",
      message: matterScan.error
        ? `Matter list scan failed: ${matterScan.error}`
        : `Matter list scan completed${Number.isFinite(matterScan.count) ? ` (${matterScan.count} visible matter${matterScan.count === 1 ? "" : "s"})` : ""}.`,
    }));
    return checks;
  }

  async function envFileCheck() {
    const envPath = path.join(root, ".env");
    try {
      const text = await fsReadFile(envPath, "utf8");
      parseEnvText(text);
      return check({
        id: "config.env_parseable",
        category: "configuration",
        label: "Local .env parseable",
        status: "ok",
        message: "Local .env was parsed without exposing values.",
        detail: safePath(envPath),
      });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return check({
          id: "config.env_parseable",
          category: "configuration",
          label: "Local .env parseable",
          status: "warning",
          message: "No local .env file found; explicit shell environment variables may still configure the app.",
          detail: safePath(envPath),
        });
      }
      return check({
        id: "config.env_parseable",
        category: "configuration",
        label: "Local .env parseable",
        status: "error",
        message: `Local .env could not be read: ${safeMessage(error)}`,
        detail: safePath(envPath),
      });
    }
  }

  async function pathAccessCheck({
    id,
    category,
    label,
    targetPath,
    mode,
    okMessage,
    failMessage,
    missingStatus = "error",
  }) {
    try {
      await fsAccess(targetPath, mode);
      return check({ id, category, label, status: "ok", message: okMessage, detail: safePath(targetPath) });
    } catch (error) {
      return check({
        id,
        category,
        label,
        status: error?.code === "ENOENT" ? missingStatus : "error",
        message: `${failMessage}${error?.code ? ` (${error.code})` : ""}`,
        detail: safePath(targetPath),
      });
    }
  }

  async function safeReadJobs(limit) {
    if (typeof jobStatusService?.listJobs !== "function") return { items: [] };
    try {
      const result = await jobStatusService.listJobs({ limit });
      return { items: Array.isArray(result?.jobs) ? result.jobs : [] };
    } catch (error) {
      return { items: [], error: safeMessage(error) };
    }
  }

  async function safeReadInteractions(limit) {
    if (typeof commandInteractionLogService?.readRecentInteractions !== "function") return { items: [] };
    try {
      return { items: await commandInteractionLogService.readRecentInteractions({ limit }) };
    } catch (error) {
      return { items: [], error: safeMessage(error) };
    }
  }

  async function safeReadPrivateBetaObservability(limit) {
    if (typeof privateBetaObservabilityService?.readObservability !== "function") return { available: false };
    try {
      return { available: true, report: await privateBetaObservabilityService.readObservability({ limit }) };
    } catch (error) {
      return { available: true, error: safeMessage(error) };
    }
  }

  async function safeListMatterChildren() {
    if (typeof matterStore?.listMattersHomeChildren !== "function") return { count: null };
    try {
      const matters = await matterStore.listMattersHomeChildren();
      return { count: Array.isArray(matters) ? matters.length : 0 };
    } catch (error) {
      return { count: null, error: safeMessage(error) };
    }
  }
}

function runtimeStorageModeLabel({ matterStore, runtimeDbStorageService } = {}) {
  if (matterStore?.hasRuntimeDbStorageMode?.() && runtimeDbStorageService) return "postgres";
  return "filesystem";
}

function check({ id, category, label, status, message, detail = "", evidence = [], recommendation = "" }) {
  return {
    id,
    category,
    label,
    status: ["ok", "warning", "error"].includes(status) ? status : "warning",
    message: redactSensitiveText(String(message || "")),
    ...(detail ? { detail: redactSensitiveText(String(detail)) } : {}),
    ...(Array.isArray(evidence) && evidence.length ? { evidence: redactSensitiveValues(evidence) } : {}),
    ...(recommendation ? { recommendation } : {}),
  };
}

function aggregateStatus(checks = []) {
  let status = "ok";
  for (const item of checks) {
    if ((STATUS_RANK[item.status] || 0) > STATUS_RANK[status]) status = item.status;
  }
  return status;
}

function summarizeChecks(checks = []) {
  const counts = { ok: 0, warning: 0, error: 0 };
  for (const item of checks) {
    if (Object.prototype.hasOwnProperty.call(counts, item.status)) counts[item.status] += 1;
  }
  return {
    ...counts,
    checks: checks.length,
    blockingIssues: counts.error,
  };
}

function recommendationsForChecks(checks = []) {
  return checks
    .map((item) => item.recommendation)
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, 8);
}

function safeMessage(error) {
  return redactSensitiveText(error?.message || String(error || "unknown error"));
}

function safePath(value) {
  return redactSensitiveText(String(value || ""));
}
