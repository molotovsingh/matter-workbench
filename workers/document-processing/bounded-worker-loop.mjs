export class BoundedDocumentWorkerLoop {
  constructor({
    worker,
    tenantId,
    workerIdPrefix = "document-worker",
    concurrency = 1,
    idlePollMs = 250,
    maximumIdlePollMs = 1_000,
    baseErrorBackoffMs = 1_000,
    maximumErrorBackoffMs = 30_000,
    onOutcome = async () => {},
    sleep = abortableSleep,
  } = {}) {
    if (!worker?.runOnce) throw new Error("bounded worker loop requires worker.runOnce");
    if (!String(tenantId || "").trim()) throw new Error("bounded worker loop requires tenantId");
    if (typeof onOutcome !== "function") throw new Error("onOutcome must be a function");
    this.worker = worker;
    this.tenantId = String(tenantId);
    this.workerIdPrefix = String(workerIdPrefix || "document-worker").slice(0, 160);
    this.concurrency = boundedInteger(concurrency, "concurrency", 1, 1_000);
    this.idlePollMs = boundedInteger(idlePollMs, "idlePollMs", 10, 60_000);
    this.maximumIdlePollMs = boundedInteger(maximumIdlePollMs, "maximumIdlePollMs", this.idlePollMs, 5 * 60_000);
    this.baseErrorBackoffMs = boundedInteger(baseErrorBackoffMs, "baseErrorBackoffMs", 10, 60_000);
    this.maximumErrorBackoffMs = boundedInteger(maximumErrorBackoffMs, "maximumErrorBackoffMs", this.baseErrorBackoffMs, 15 * 60_000);
    this.onOutcome = onOutcome;
    this.sleep = sleep;
  }

  async run({ signal, maximumIterationsPerLane = Infinity } = {}) {
    const lanes = Array.from({ length: this.concurrency }, (_, index) => this.runLane({
      lane: index + 1,
      signal,
      maximumIterations: normalizeIterations(maximumIterationsPerLane),
    }));
    const results = await Promise.all(lanes);
    return results.reduce((total, result) => ({
      iterations: total.iterations + result.iterations,
      completed: total.completed + result.completed,
      deferred: total.deferred + result.deferred,
      idle: total.idle + result.idle,
      errors: total.errors + result.errors,
    }), { iterations: 0, completed: 0, deferred: 0, idle: 0, errors: 0 });
  }

  async runLane({ lane, signal, maximumIterations }) {
    const stats = { iterations: 0, completed: 0, deferred: 0, idle: 0, errors: 0 };
    let consecutiveErrors = 0;
    let consecutiveQuiet = 0;
    while (!signal?.aborted && stats.iterations < maximumIterations) {
      stats.iterations += 1;
      const workerId = `${this.workerIdPrefix}-${lane}`;
      try {
        const outcome = await this.worker.runOnce({ tenantId: this.tenantId, workerId });
        consecutiveErrors = 0;
        if (!outcome) {
          stats.idle += 1;
          consecutiveQuiet += 1;
          // Idle and admission-gated lanes back off their queue polling so a
          // large parked lane pool costs the database almost nothing.
          await this.sleep(Math.min(this.maximumIdlePollMs, this.idlePollMs * (2 ** Math.min(10, consecutiveQuiet - 1))), signal);
          continue;
        }
        if (outcome.status === "deferred") {
          // Admission gating is transient: capacity can open at any moment
          // (slow start doubling, a cooldown ending), so a gated lane keeps
          // the short poll floor and only waits longer when the controller
          // says exactly how long. Growing this delay would leave lanes idle
          // through the capacity they were waiting for.
          stats.deferred += 1;
          await this.notify({ type: "deferred", workerId, outcome });
          await this.sleep(clampDelay(outcome.retryAfterMs, this.idlePollMs, this.maximumErrorBackoffMs), signal);
          continue;
        }
        consecutiveQuiet = 0;
        stats.completed += 1;
        await this.notify({ type: "completed", workerId, outcome: sanitizeOutcome(outcome) });
      } catch (error) {
        stats.errors += 1;
        consecutiveErrors += 1;
        const delayMs = Math.min(this.maximumErrorBackoffMs, this.baseErrorBackoffMs * (2 ** Math.min(20, consecutiveErrors - 1)));
        await this.notify({ type: "error", workerId, errorCode: safeCode(error?.code), delayMs });
        await this.sleep(delayMs, signal);
      }
    }
    return stats;
  }

  async notify(event) {
    try { await this.onOutcome(event); } catch { /* Telemetry cannot stop processing. */ }
  }
}

export function abortableSleep(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    timer.unref?.();
    function done() {
      signal?.removeEventListener?.("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener?.("abort", done, { once: true });
  });
}

function sanitizeOutcome(outcome) {
  return {
    status: String(outcome?.status || "completed"),
    workUnitCount: Array.isArray(outcome?.workUnitIds) ? outcome.workUnitIds.length : outcome?.workUnitId ? 1 : 0,
    firstPage: Number.isInteger(outcome?.firstPage) ? outcome.firstPage : null,
    lastPage: Number.isInteger(outcome?.lastPage) ? outcome.lastPage : null,
    errorCode: safeCode(outcome?.errorCode, ""),
  };
}

function safeCode(value, fallback = "worker.loop_error") {
  const code = String(value || fallback);
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/.test(code) ? code : fallback;
}
function clampDelay(value, fallback, maximum) { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.min(maximum, Math.max(10, Math.ceil(number))) : fallback; }
function normalizeIterations(value) { if (value === Infinity) return Infinity; return boundedInteger(value, "maximumIterationsPerLane", 1, 1_000_000_000); }
function boundedInteger(value, field, minimum, maximum) { const number = Number(value); if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`); return number; }
