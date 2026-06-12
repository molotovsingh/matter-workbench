const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

export function createPrivateBetaTelemetryRetryService({
  feedbackService,
  metricsService,
  metricsContextProvider,
  signalService,
  intervalMs = DEFAULT_INTERVAL_MS,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  log = console,
} = {}) {
  let timer = null;
  let running = false;

  async function runOnce() {
    if (running) return { skipped: true, reason: "already_running" };
    running = true;
    const result = { completed: true, feedback: null, metrics: null, signals: null };
    try {
      result.feedback = await runQueue("feedback", feedbackService?.syncQueuedFeedback);
      result.metrics = await runMetrics();
      result.signals = await runQueue("signals", signalService?.syncQueuedSignals);
      return result;
    } finally {
      running = false;
    }
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

  return { runOnce, start, stop };
}

function redactRetryError(value) {
  return String(value || "sync failed")
    .replace(/\b(password|token|secret)\s*[:=]\s*([^\s"'`]+)/gi, "$1=[redacted-secret]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted-secret]")
    .slice(0, 300);
}
