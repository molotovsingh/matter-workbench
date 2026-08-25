import { randomUUID } from "node:crypto";

import { CONTRACT_VERSIONS } from "../../packages/extraction-contracts/index.mjs";
import { publishEligibleIntakes } from "../../services/document-intake-extraction/assembly.mjs";
import { providerCapabilityKey } from "../../services/document-intake-extraction/providers/pinned-provider-adapter.mjs";

export class DocumentProcessingWorker {
  constructor({
    controlPlane,
    objectStore,
    providers = [],
    validator,
    clock = () => new Date(),
    idFactory = (kind) => `${kind}_${randomUUID()}`,
    leaseMs = 60_000,
  } = {}) {
    if (!controlPlane?.read || !controlPlane?.transact) throw new Error("document worker requires a control plane");
    if (!objectStore?.readBlob) throw new Error("document worker requires an object store");
    if (!validator?.validate || !validator?.version) throw new Error("document worker requires a versioned validator");
    this.controlPlane = controlPlane;
    this.objectStore = objectStore;
    this.providers = new Map(providers.map((provider) => [providerCapabilityKey(provider.capability), provider]));
    this.validator = validator;
    this.clock = clock;
    this.idFactory = idFactory;
    this.leaseMs = Math.max(1_000, Number(leaseMs) || 60_000);
  }

  async runOnce({ workerId = "document-worker" } = {}) {
    const claim = await this.claimNext({ workerId });
    if (!claim) return null;
    const provider = this.providers.get(providerCapabilityKey(claim.capability));
    if (!provider) {
      const error = new Error(`no provider adapter registered for ${claim.capability.provider}/${claim.capability.model}`);
      error.code = "worker.provider_unavailable";
      error.billingKnown = true;
      error.billedCostUsd = 0;
      await this.finishFailure(claim, error);
      return { workUnitId: claim.workUnitId, status: "failed_attempt" };
    }
    let providerResult;
    const stopHeartbeat = this.startHeartbeat(claim);
    try {
      providerResult = await provider.extractPage({
        pageNumber: claim.pageNumber,
        sourceSha256: claim.sourceSha256,
        fingerprint: claim.fingerprint,
        source: {
          blobReference: claim.blobReference,
          readBytes: () => this.objectStore.readBlob(claim.blobReference),
        },
        heartbeat: () => this.renewLease(claim),
      });
    } catch (error) {
      stopHeartbeat();
      await this.finishFailure(claim, error);
      return { workUnitId: claim.workUnitId, status: "failed_attempt", errorCode: error?.code || "provider.failed" };
    }
    stopHeartbeat();
    const validation = this.validator.validate(providerResult);
    await this.finishSuccess(claim, providerResult, validation);
    return { workUnitId: claim.workUnitId, status: validation.outcome };
  }

  async drain({ workerId = "document-worker", maximumClaims = 10_000 } = {}) {
    const completed = [];
    for (let index = 0; index < maximumClaims; index += 1) {
      const result = await this.runOnce({ workerId });
      if (!result) break;
      completed.push(result);
    }
    return completed;
  }

  startHeartbeat(claim) {
    const intervalMs = Math.max(250, Math.min(10_000, Math.trunc(this.leaseMs / 3)));
    const timer = setInterval(() => {
      this.renewLease(claim).catch(() => {});
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  async renewLease(claim) {
    const nowDate = this.clock();
    const now = nowDate.toISOString();
    return this.controlPlane.transact((state) => {
      const work = fencedWork(state, claim);
      work.lease.lastHeartbeatAt = now;
      work.lease.expiresAt = new Date(nowDate.getTime() + this.leaseMs).toISOString();
      work.updatedAt = now;
      return structuredClone(work.lease);
    });
  }

  async claimNext({ workerId }) {
    const nowDate = this.clock();
    const now = nowDate.toISOString();
    return this.controlPlane.transact((state) => {
      expireLeases(state, { nowDate, now, idFactory: this.idFactory });
      publishEligibleIntakes(state, { now, idFactory: this.idFactory });
      const work = Object.values(state.workUnits)
        .filter((candidate) => candidate.status === "queued")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.pageNumber - right.pageNumber)[0];
      if (!work) return null;
      const leaseToken = this.idFactory("lease");
      const attemptId = this.idFactory("attempt");
      work.status = "running";
      work.attemptCount += 1;
      work.lease = {
        token: leaseToken,
        workerId: String(workerId || "document-worker"),
        attemptId,
        claimedAt: now,
        lastHeartbeatAt: now,
        expiresAt: new Date(nowDate.getTime() + this.leaseMs).toISOString(),
      };
      work.updatedAt = now;
      state.attempts.push({
        schemaVersion: CONTRACT_VERSIONS.providerAttempt,
        attemptId,
        workUnitId: work.workUnitId,
        fingerprint: work.fingerprint,
        provider: work.capability.provider,
        model: work.capability.model,
        adapterVersion: work.capability.adapterVersion,
        attemptNumber: work.attemptCount,
        status: "running",
        startedAt: now,
        finishedAt: null,
        latencyMs: null,
        requestId: "",
        usage: { inputUnits: null, outputUnits: null },
        billedCostUsd: null,
        costMeasurementStatus: "pending",
        errorCode: "",
        errorMessage: "",
      });
      return structuredClone({ ...work, leaseToken, attemptId });
    });
  }

  async finishSuccess(claim, providerResult, validation) {
    const finishedDate = this.clock();
    const finishedAt = finishedDate.toISOString();
    return this.controlPlane.transact((state) => {
      const work = fencedWork(state, claim);
      const attempt = requireAttempt(state, claim.attemptId);
      completeAttempt(attempt, {
        status: validation.outcome,
        finishedAt,
        latencyMs: elapsedMs(attempt.startedAt, finishedDate),
        requestId: providerResult.requestId,
        usage: providerResult.usage,
        billedCostUsd: providerResult.billedCostUsd,
        costMeasurementStatus: "measured",
      });
      recordCostEvent(state, attempt, work, { idFactory: this.idFactory, occurredAt: finishedAt });
      work.status = validation.outcome;
      work.lease = null;
      work.output = {
        text: providerResult.text,
        finishReason: providerResult.finishReason,
        reviewReasons: validation.reasons,
        validatorVersion: validation.validatorVersion,
        attemptId: attempt.attemptId,
        requestId: providerResult.requestId,
      };
      work.updatedAt = finishedAt;
      publishEligibleIntakes(state, { now: finishedAt, idFactory: this.idFactory });
      return structuredClone(work);
    });
  }

  async finishFailure(claim, error) {
    const finishedDate = this.clock();
    const finishedAt = finishedDate.toISOString();
    return this.controlPlane.transact((state) => {
      const work = fencedWork(state, claim);
      const attempt = requireAttempt(state, claim.attemptId);
      const billingKnown = error?.billingKnown === true || Number.isFinite(Number(error?.billedCostUsd));
      completeAttempt(attempt, {
        status: "failed",
        finishedAt,
        latencyMs: elapsedMs(attempt.startedAt, finishedDate),
        usage: {
          inputUnits: finiteOrNull(error?.usage?.inputUnits),
          outputUnits: finiteOrNull(error?.usage?.outputUnits),
        },
        billedCostUsd: billingKnown ? Math.max(0, Number(error?.billedCostUsd) || 0) : null,
        costMeasurementStatus: billingKnown ? "measured" : "unknown_requires_reconciliation",
        errorCode: clean(error?.code || "provider.failed", 120),
        errorMessage: clean(error?.message || error || "provider call failed", 500),
      });
      recordCostEvent(state, attempt, work, { idFactory: this.idFactory, occurredAt: finishedAt });
      work.lease = null;
      work.updatedAt = finishedAt;
      if (work.attemptCount < work.maximumAttempts) {
        work.status = "queued";
      } else {
        work.status = "review_required";
        work.output = {
          text: "",
          finishReason: "failed",
          reviewReasons: ["provider_attempts_exhausted", attempt.errorCode],
          validatorVersion: this.validator.version,
          attemptId: attempt.attemptId,
          requestId: "",
        };
        publishEligibleIntakes(state, { now: finishedAt, idFactory: this.idFactory });
      }
      return structuredClone(work);
    });
  }
}

function expireLeases(state, { nowDate, now, idFactory }) {
  for (const work of Object.values(state.workUnits)) {
    if (work.status !== "running" || !work.lease || new Date(work.lease.expiresAt) > nowDate) continue;
    const attempt = state.attempts.find((candidate) => candidate.attemptId === work.lease.attemptId);
    if (attempt?.status === "running") {
      completeAttempt(attempt, {
        status: "lease_expired",
        finishedAt: now,
        latencyMs: elapsedMs(attempt.startedAt, nowDate),
        billedCostUsd: null,
        costMeasurementStatus: "unknown_requires_reconciliation",
        errorCode: "worker.lease_expired",
        errorMessage: "Worker lease expired before the provider attempt checkpoint was committed.",
      });
      recordCostEvent(state, attempt, work, { idFactory, occurredAt: now });
    }
    work.lease = null;
    work.updatedAt = now;
    if (work.attemptCount < work.maximumAttempts) {
      work.status = "queued";
    } else {
      work.status = "review_required";
      work.output = {
        text: "",
        finishReason: "failed",
        reviewReasons: ["worker_leases_exhausted"],
        validatorVersion: work.validatorVersion,
        attemptId: attempt?.attemptId || "",
        requestId: "",
      };
    }
  }
}

function fencedWork(state, claim) {
  const work = state.workUnits[claim.workUnitId];
  if (!work || work.status !== "running" || work.lease?.token !== claim.leaseToken || work.lease?.attemptId !== claim.attemptId) {
    const error = new Error("worker lease ownership was lost before checkpoint");
    error.code = "worker.lease_lost";
    throw error;
  }
  return work;
}

function requireAttempt(state, attemptId) {
  const attempt = state.attempts.find((candidate) => candidate.attemptId === attemptId);
  if (!attempt) throw new Error(`provider attempt ${attemptId} not found`);
  return attempt;
}

function completeAttempt(attempt, patch) {
  Object.assign(attempt, patch);
}

function recordCostEvent(state, attempt, work, { idFactory, occurredAt }) {
  state.costEvents.push({
    schemaVersion: CONTRACT_VERSIONS.costEvent,
    costEventId: idFactory("cost"),
    attemptId: attempt.attemptId,
    workUnitId: work.workUnitId,
    fingerprint: work.fingerprint,
    tenantId: work.tenantId,
    provider: attempt.provider,
    model: attempt.model,
    adapterVersion: attempt.adapterVersion,
    attemptStatus: attempt.status,
    inputUnits: attempt.usage?.inputUnits ?? null,
    outputUnits: attempt.usage?.outputUnits ?? null,
    billedCostUsd: attempt.billedCostUsd,
    measurementStatus: attempt.costMeasurementStatus,
    occurredAt,
  });
}

function elapsedMs(startedAt, finishedDate) {
  return Math.max(0, finishedDate.getTime() - new Date(startedAt).getTime());
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function clean(value, maximum) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maximum);
}
