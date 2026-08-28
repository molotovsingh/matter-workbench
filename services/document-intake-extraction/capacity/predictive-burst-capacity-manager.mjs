export class PredictiveBurstCapacityManager {
  constructor({ store, provisioner, clock = () => new Date(), requestTtlMs = 15 * 60 * 1000, baseRetryMs = 5_000, maximumRetryMs = 5 * 60 * 1000 } = {}) {
    if (!store?.request || !store?.claimDue || !store?.markApplied || !store?.markFailed) throw new Error("burst capacity manager requires a durable store");
    if (!provisioner?.setDesiredCapacity) throw new Error("burst capacity manager requires provisioner.setDesiredCapacity");
    this.store = store;
    this.provisioner = provisioner;
    this.clock = clock;
    this.requestTtlMs = positiveInteger(requestTtlMs, "requestTtlMs");
    this.baseRetryMs = positiveInteger(baseRetryMs, "baseRetryMs");
    this.maximumRetryMs = positiveInteger(maximumRetryMs, "maximumRetryMs");
  }

  async requestFromPlan({ tenantId, poolId, workloadClass = "default", plan } = {}) {
    if (plan?.schemaVersion !== "document-intake-extraction.capacity-plan/v1") throw new Error("capacity plan v1 is required");
    const now = this.clock();
    const window = plan.uploadScaleWindow || {};
    const delaySeconds = window.action === "schedule_during_upload"
      ? Math.max(0, Number(window.remainingUploadSeconds || 0) - Number(window.scaleLeadSeconds || 0))
      : 0;
    const notBefore = new Date(now.getTime() + delaySeconds * 1000);
    const expiresAt = new Date(notBefore.getTime() + this.requestTtlMs);
    return this.store.request({
      tenantId,
      poolId,
      workloadClass,
      desiredWorkers: plan.workers.targetWorkers,
      minimumWorkers: plan.workers.warmWorkers,
      maximumWorkers: plan.workers.maximumWorkers,
      action: window.action || "hold",
      reason: {
        schemaVersion: plan.schemaVersion,
        action: window.action || "hold",
        additionalWorkers: window.additionalWorkers || 0,
        predictedPageOperationsHigh: plan.workload?.remainingPageOperations?.high || 0,
        exceptionReasons: Array.isArray(plan.exception?.reasons) ? plan.exception.reasons : [],
      },
      notBefore,
      expiresAt,
    });
  }

  async applyOnce({ tenantId, workerId = "predictive-capacity-manager", leaseMs = 60_000 } = {}) {
    const request = await this.store.claimDue({ tenantId, workerId, leaseMs });
    if (!request) return null;
    const idempotencyKey = `${request.capacityRequestId}:${request.generation}`;
    try {
      const result = await this.provisioner.setDesiredCapacity({
        tenantId,
        poolId: request.poolId,
        workloadClass: request.workloadClass,
        desiredWorkers: request.desiredWorkers,
        minimumWorkers: request.minimumWorkers,
        maximumWorkers: request.maximumWorkers,
        idempotencyKey,
      });
      const observedWorkers = boundedInteger(
        result?.observedWorkers ?? result?.desiredWorkers ?? request.desiredWorkers,
        "provisioner.observedWorkers",
        0,
        request.maximumWorkers,
      );
      try {
        const applied = await this.store.markApplied({
          tenantId,
          capacityRequestId: request.capacityRequestId,
          generation: request.generation,
          leaseToken: request.leaseToken,
          observedWorkers,
        });
        return { status: "applied", request: applied, idempotencyKey };
      } catch (error) {
        if (error?.code === "capacity.lease_lost") return { status: "superseded", capacityRequestId: request.capacityRequestId, idempotencyKey };
        throw error;
      }
    } catch (error) {
      if (error?.code === "capacity.lease_lost") return { status: "superseded", capacityRequestId: request.capacityRequestId, idempotencyKey };
      const retryAfterMs = retryDelay(request.attemptCount, this.baseRetryMs, this.maximumRetryMs, error?.retryAfterMs);
      try {
        const failed = await this.store.markFailed({
          tenantId,
          capacityRequestId: request.capacityRequestId,
          generation: request.generation,
          leaseToken: request.leaseToken,
          errorCode: safeCode(error?.code),
          errorMessage: safeMessage(error),
          retryAfterMs,
        });
        return { status: "failed", request: failed, retryAfterMs, idempotencyKey };
      } catch (checkpointError) {
        if (checkpointError?.code === "capacity.lease_lost") return { status: "superseded", capacityRequestId: request.capacityRequestId, idempotencyKey };
        throw checkpointError;
      }
    }
  }

  async drainTenant({ tenantId, workerId = "predictive-capacity-manager", maximumRequests = 20 } = {}) {
    const outcomes = [];
    for (let index = 0; index < maximumRequests; index += 1) {
      const outcome = await this.applyOnce({ tenantId, workerId });
      if (!outcome) break;
      outcomes.push(outcome);
      if (outcome.status === "failed") break;
    }
    return outcomes;
  }
}

export function retryDelay(attemptCount, baseRetryMs, maximumRetryMs, providerRetryAfterMs = 0) {
  const exponential = baseRetryMs * (2 ** Math.max(0, Math.min(20, Number(attemptCount || 1) - 1)));
  return Math.min(maximumRetryMs, Math.max(exponential, Number(providerRetryAfterMs) || 0));
}

function safeCode(value) {
  const code = String(value || "capacity.provision_failed");
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/.test(code) ? code : "capacity.provision_failed";
}
function safeMessage(error) {
  return String(error?.message || error || "capacity provisioning failed")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\b(Bearer)\s+[^\s,;]+/gi, "$1 [REDACTED]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/(https?:\/\/[^:/\s]+:)[^@/\s]+@/gi, "$1[REDACTED]@")
    .slice(0, 500);
}
function positiveInteger(value, field) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${field} must be a positive integer`); return number; }
function boundedInteger(value, field, minimum, maximum) { const number = Number(value); if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`); return number; }
