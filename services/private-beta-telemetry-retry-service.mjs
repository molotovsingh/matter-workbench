import { redactSensitiveText } from "../shared/secret-redaction.mjs";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TICK_DEADLINE_MS = 4 * 60 * 1000;

export function createPrivateBetaTelemetryRetryService({
  feedbackService,
  metricsService,
  metricsContextProvider,
  signalService,
  heartbeatService,
  intervalMs = DEFAULT_INTERVAL_MS,
  tickDeadlineMs = DEFAULT_TICK_DEADLINE_MS,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  log = console,
} = {}) {
  let timer = null;
  let running = false;

  async function runOnce() {
    if (running) return { skipped: true, reason: "already_running" };
    running = true;
    try {
      return await raceWithTickDeadline(drainAll());
    } finally {
      running = false;
    }
  }

  async function drainAll() {
    const result = { completed: true, feedback: null, metrics: null, signals: null, heartbeats: null };
    result.feedback = await runQueue("feedback", feedbackService?.syncQueuedFeedback);
    result.metrics = await runMetrics();
    result.heartbeats = await runHeartbeats();
    result.signals = await runQueue("signals", signalService?.syncQueuedSignals);
    return result;
  }

  function raceWithTickDeadline(work) {
    const deadlineMs = Number(tickDeadlineMs);
    if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) return work;
    let deadlineTimer;
    const deadline = new Promise((resolve) => {
      deadlineTimer = setTimeout(() => {
        log.error?.(`private beta telemetry tick exceeded ${deadlineMs}ms; drain continues in background`);
        resolve({ completed: false, timedOut: true });
      }, deadlineMs);
    });
    return Promise.race([work, deadline]).finally(() => clearTimeout(deadlineTimer));
  }

  function start({ immediate = false } = {}) {
    if (!timer) {
      timer = setIntervalImpl(() => runOnce(), intervalMs);
      timer?.unref?.();
    }
    if (immediate) void runOnce();
  }

  function stop() {
    if (!timer) return;
    clearIntervalImpl(timer);
    timer = null;
  }

  async function runQueue(label, operation) {
    if (typeof operation !== "function") return { skipped: true, reason: "unavailable" };
    try {
      return await operation.call(label === "feedback" ? feedbackService : signalService);
    } catch (error) {
      log.error?.(`private beta ${label} retry failed: ${redactRetryError(error?.message)}`);
      return { failed: true };
    }
  }

  async function runMetrics() {
    if (typeof metricsService?.captureRuntimeSnapshot !== "function") {
      return { skipped: true, reason: "unavailable" };
    }
    try {
      const context = typeof metricsContextProvider === "function" ? metricsContextProvider() : {};
      const snapshot = await metricsService.captureRuntimeSnapshot(context);
      const queued = typeof metricsService.syncQueuedMetrics === "function"
        ? await metricsService.syncQueuedMetrics()
        : { skipped: true, reason: "unavailable" };
      return {
        captured: true,
        syncStatus: snapshot?.sync?.status || "unknown",
        queued,
      };
    } catch (error) {
      log.error?.(`private beta metrics retry failed: ${redactRetryError(error?.message)}`);
      return { failed: true };
    }
  }

  async function runHeartbeats() {
    if (typeof heartbeatService?.captureHeartbeat !== "function") {
      return { skipped: true, reason: "unavailable" };
    }
    try {
      const heartbeat = await heartbeatService.captureHeartbeat();
      const queued = typeof heartbeatService.syncQueuedHeartbeats === "function"
        ? await heartbeatService.syncQueuedHeartbeats()
        : { skipped: true, reason: "unavailable" };
      return {
        captured: true,
        syncStatus: heartbeat?.sync?.status || "unknown",
        queued,
      };
    } catch (error) {
      log.error?.(`private beta heartbeat retry failed: ${redactRetryError(error?.message)}`);
      return { failed: true };
    }
  }

  return { runOnce, start, stop };
}

function redactRetryError(value) {
  return redactSensitiveText(String(value || "sync failed")).slice(0, 300);
}
