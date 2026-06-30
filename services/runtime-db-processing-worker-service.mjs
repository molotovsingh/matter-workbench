import process from "node:process";

import { redactSensitiveText } from "../shared/secret-redaction.mjs";

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_LOCK_MS = 5 * 60 * 1000;

export function createRuntimeDbProcessingWorkerService({
  runtimeDbStorageService,
  env = process.env,
  logger = console,
  workerId = `runtime-worker-${process.pid}`,
  intervalMs = DEFAULT_INTERVAL_MS,
  lockMs = DEFAULT_LOCK_MS,
} = {}) {
  let timer = null;
  let running = false;
  let stopped = false;

  function enabled() {
    if (!runtimeDbStorageService?.enabled) return false;
    if (typeof runtimeDbStorageService.claimNextProcessingJob !== "function") return false;
    if (typeof runtimeDbStorageService.extractDocuments !== "function") return false;
    if (typeof runtimeDbStorageService.completeProcessingJob !== "function") return false;
    if (typeof runtimeDbStorageService.failProcessingJob !== "function") return false;
    const configured = String(env.MWB_RUNTIME_DB_PROCESSING_WORKER || env.MWB_RUNTIME_DB_WORKER || "").trim().toLowerCase();
    return ["1", "true", "on", "yes"].includes(configured);
  }

  function start() {
    if (!enabled() || timer) return false;
    stopped = false;
    timer = setInterval(() => {
      drainOnce().catch((error) => log("warn", `Runtime DB processing worker failed: ${safeMessage(error)}`));
    }, Math.max(500, Number(intervalMs) || DEFAULT_INTERVAL_MS));
    if (typeof timer.unref === "function") timer.unref();
    void drainOnce().catch((error) => log("warn", `Runtime DB processing worker failed: ${safeMessage(error)}`));
    return true;
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function drainOnce() {
    if (running || stopped || !enabled()) return { claimed: 0 };
    running = true;
    let claimed = 0;
    try {
      while (!stopped) {
        const job = await runtimeDbStorageService.claimNextProcessingJob({ workerId, kinds: ["extract"], lockMs });
        if (!job?.id) break;
        claimed += 1;
        await runJob(job);
      }
      return { claimed };
    } finally {
      running = false;
    }
  }

  async function runJob(job) {
    try {
      if (job.kind === "extract") {
        if (!job.matter?.id) throw new Error("Processing job is missing matter context.");
        const result = await runtimeDbStorageService.extractDocuments(job.matter, {
          dryRun: false,
          forceRefresh: false,
          env,
        });
        await runtimeDbStorageService.completeProcessingJob(job.id, {
          progress: {
            completedStage: "extract",
            operationState: result?.operationResult?.state || result?.state || "succeeded",
          },
        });
        return;
      }
      throw new Error(`Unsupported runtime processing job kind: ${job.kind || "unknown"}`);
    } catch (error) {
      await runtimeDbStorageService.failProcessingJob(job.id, error, {
        errorCode: error?.code || "processing.extract.failed",
        progress: { failedStage: job.kind || "unknown" },
      });
    }
  }

  function log(level, message) {
    if (typeof logger?.[level] === "function") logger[level](message);
    else if (typeof logger?.log === "function") logger.log(message);
  }

  return {
    enabled,
    start,
    stop,
    drainOnce,
  };
}

function safeMessage(error) {
  return redactSensitiveText(String(error?.message || error || "unknown")).slice(0, 500);
}
