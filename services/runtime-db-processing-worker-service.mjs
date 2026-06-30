import process from "node:process";

import {
  firstQueueableRuntimePreparationStage,
  normalizeRuntimePreparationJobKind,
  runtimePreparationJobKindForStage,
  safeRuntimePreparationChainId,
} from "../shared/runtime-preparation-jobs.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_LOCK_MS = 5 * 60 * 1000;

const BUILTIN_STAGE_HANDLERS = [
  {
    kind: "matter_init",
    method: "initializeMatter",
    completedStage: "matter_init",
    run: (service, matter, { env }) => service.initializeMatter(matter, { dryRun: false, env }),
  },
  {
    kind: "extract",
    method: "extractDocuments",
    completedStage: "extract",
    run: (service, matter, { env }) => service.extractDocuments(matter, { dryRun: false, forceRefresh: false, env }),
  },
  {
    kind: "source_labels",
    method: "describeSources",
    completedStage: "source_labels",
    run: (service, matter, { env }) => service.describeSources(matter, { dryRun: false, env }),
  },
  {
    kind: "case_timeline",
    method: "createListOfDates",
    completedStage: "case_timeline",
    run: (service, matter, { env }) => service.createListOfDates(matter, { dryRun: false, env }),
  },
];

export function createRuntimeDbProcessingWorkerService({
  runtimeDbStorageService,
  env = process.env,
  logger = console,
  workerId = `runtime-worker-${process.pid}`,
  intervalMs = DEFAULT_INTERVAL_MS,
  lockMs = DEFAULT_LOCK_MS,
  stageHandlers = {},
} = {}) {
  let timer = null;
  let running = false;
  let stopped = false;

  function supportedKinds() {
    const builtin = BUILTIN_STAGE_HANDLERS
      .filter((handler) => typeof runtimeDbStorageService?.[handler.method] === "function")
      .map((handler) => handler.kind);
    const custom = Object.entries(stageHandlers || {})
      .filter(([, handler]) => typeof handler === "function")
      .map(([kind]) => normalizeRuntimePreparationJobKind(kind))
      .filter(Boolean);
    return [...new Set([...builtin, ...custom])];
  }

  function enabled() {
    if (!runtimeDbStorageService?.enabled) return false;
    if (typeof runtimeDbStorageService.claimNextProcessingJob !== "function") return false;
    if (typeof runtimeDbStorageService.completeProcessingJob !== "function") return false;
    if (typeof runtimeDbStorageService.failProcessingJob !== "function") return false;
    if (!supportedKinds().length) return false;
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
        const job = await runtimeDbStorageService.claimNextProcessingJob({ workerId, kinds: supportedKinds(), lockMs });
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
    const kind = normalizeRuntimePreparationJobKind(job?.kind);
    try {
      if (!job?.matter?.id) throw new Error("Processing job is missing matter context.");
      const handler = handlerForKind(kind);
      if (!handler) throw new Error(`Unsupported runtime processing job kind: ${kind || "unknown"}`);
      const result = await handler.run(runtimeDbStorageService, job.matter, { env, job });
      await runtimeDbStorageService.completeProcessingJob(job.id, {
        progress: {
          completedStage: handler.completedStage || kind,
          operationState: result?.operationResult?.state || result?.state || "succeeded",
        },
      });
      try {
        await enqueueNextPreparationJob({ completedKind: kind, job });
      } catch (enqueueError) {
        log("warn", `Runtime DB processing worker could not queue follow-up preparation: ${safeMessage(enqueueError)}`);
      }
    } catch (error) {
      await runtimeDbStorageService.failProcessingJob(job.id, error, {
        errorCode: error?.code || `processing.${kind || "unknown"}.failed`,
        progress: { failedStage: kind || "unknown" },
      });
    }
  }

  async function enqueueNextPreparationJob({ completedKind, job } = {}) {
    if (typeof runtimeDbStorageService?.enqueueProcessingJob !== "function") return null;
    if (typeof runtimeDbStorageService?.readPrepareMatterPlan !== "function") return null;
    if (!job?.matter?.id) return null;
    const plan = await runtimeDbStorageService.readPrepareMatterPlan(job.matter, { includeDisputeStory: true });
    const nextStage = firstQueueableRuntimePreparationStage(plan);
    const nextKind = runtimePreparationJobKindForStage(nextStage);
    if (!nextKind || nextKind === completedKind || !supportedKinds().includes(nextKind)) return null;
    const chainId = preparationChainIdForJob(job);
    return runtimeDbStorageService.enqueueProcessingJob({
      matter: job.matter,
      kind: nextKind,
      idempotencyKey: `prepare-chain:${job.matter.id}:${chainId}:${nextKind}`,
      metadata: {
        preparationChain: "post_upload/v1",
        preparationChainId: chainId,
        stage: nextKind,
        queuedAfterKind: completedKind,
        queuedAfterJobId: job.id,
        uploadSessionId: stringOrEmpty(job.progress?.uploadSessionId),
      },
    });
  }

  function handlerForKind(kind) {
    const customHandler = stageHandlers?.[kind];
    if (typeof customHandler === "function") {
      return {
        kind,
        completedStage: kind,
        run: (_service, matter, context) => customHandler({ matter, ...context }),
      };
    }
    return BUILTIN_STAGE_HANDLERS.find((handler) => handler.kind === kind && typeof runtimeDbStorageService?.[handler.method] === "function") || null;
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
    supportedKinds,
  };
}

function preparationChainIdForJob(job = {}) {
  return safeRuntimePreparationChainId(job.progress?.preparationChainId)
    || safeRuntimePreparationChainId(job.progress?.uploadSessionId)
    || safeRuntimePreparationChainId(job.id)
    || "unknown";
}

function stringOrEmpty(value) {
  return String(value || "").trim();
}

function safeMessage(error) {
  return redactSensitiveText(String(error?.message || error || "unknown")).slice(0, 500);
}
