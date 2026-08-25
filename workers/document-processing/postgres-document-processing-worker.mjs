import { readFile } from "node:fs/promises";

import { providerCapabilityKey } from "../../services/document-intake-extraction/providers/pinned-provider-adapter.mjs";

export class PostgresDocumentProcessingWorker {
  constructor({ workRepository, resultRepository = null, objectStore, scratchSpace, pageMaterializer, providers = [], validator, repairRouter = null, admissionController = null, capacityCalibration = null, clock = () => new Date(), leaseMs = 60_000 } = {}) {
    if (!workRepository?.claim || !workRepository?.renew || !workRepository?.finishSuccess || !workRepository?.finishFailure) {
      throw new Error("PostgreSQL worker requires a work repository");
    }
    if (!objectStore?.openBlobStream) throw new Error("PostgreSQL worker requires a streaming object store");
    if (!scratchSpace?.withTaskScratch || !scratchSpace?.materializeBlob) throw new Error("PostgreSQL worker requires bounded scratch");
    if (!pageMaterializer?.materializePage) throw new Error("PostgreSQL worker requires a page materializer");
    if (!validator?.validate || !validator?.version) throw new Error("PostgreSQL worker requires a versioned validator");
    if (resultRepository && !resultRepository.publishReadyIntake) throw new Error("resultRepository.publishReadyIntake is required");
    if (repairRouter && !repairRouter.select) throw new Error("repairRouter.select is required");
    if (admissionController && (!admissionController.acquire || !admissionController.complete || !admissionController.cancel)) {
      throw new Error("admissionController requires acquire, complete, and cancel");
    }
    if (admissionController && providers.length !== 1) throw new Error("admission-controlled page workers require one dedicated provider capability");
    if (capacityCalibration && !capacityCalibration.recordProvider) throw new Error("capacityCalibration.recordProvider is required");
    this.workRepository = workRepository;
    this.resultRepository = resultRepository;
    this.objectStore = objectStore;
    this.scratchSpace = scratchSpace;
    this.pageMaterializer = pageMaterializer;
    this.providers = new Map(providers.map((provider) => [providerCapabilityKey(provider.capability), provider]));
    this.validator = validator;
    this.repairRouter = repairRouter;
    this.admissionController = admissionController;
    this.admissionCapability = providers[0]?.capability || null;
    this.capacityCalibration = capacityCalibration;
    this.clock = clock;
    this.leaseMs = Math.max(1_000, Number(leaseMs) || 60_000);
  }

  async runOnce({ tenantId, workerId = "postgres-document-worker", workloadClass = "default" } = {}) {
    const admission = this.admissionController?.acquire(this.admissionCapability, { weight: 1 }) || { admitted: true, permit: null };
    if (!admission.admitted) return { status: "deferred", admissionReason: admission.reason, retryAfterMs: admission.retryAfterMs };
    let claim;
    try {
      claim = await this.workRepository.claim({ tenantId, workerId, leaseMs: this.leaseMs });
    } catch (error) {
      if (admission.permit) this.admissionController.cancel(admission.permit);
      throw error;
    }
    if (!claim) {
      if (admission.permit) this.admissionController.cancel(admission.permit);
      return null;
    }
    const provider = this.providers.get(providerCapabilityKey(claim.capability));
    if (!provider) {
      if (admission.permit) this.admissionController.cancel(admission.permit);
      const error = measuredLocalError(`no provider registered for ${claim.capability.provider}/${claim.capability.model}`, "worker.provider_unavailable");
      const failed = await this.workRepository.finishFailure({ tenantId, claim, error });
      const publications = failed.status === "review_required" ? await this.publishAffected(tenantId, failed) : [];
      return { workUnitId: claim.workUnitId, status: failed.status, errorCode: error.code, publications };
    }

    const stopHeartbeat = this.startHeartbeat({ tenantId, claim });
    let providerResult;
    let providerStarted = false;
    let providerStartedAtMs = 0;
    let capacityRecorded = false;
    try {
      providerResult = await this.scratchSpace.withTaskScratch({
        taskId: claim.workUnitId,
        expectedBytes: claim.sourceBytes,
      }, async (allocation) => {
        const source = await this.scratchSpace.materializeBlob({
          allocation,
          objectStore: this.objectStore,
          blobReference: claim.blobReference,
          fileName: "source/source.pdf",
        });
        const page = await this.pageMaterializer.materializePage({
          sourceFilePath: source.filePath,
          pageNumber: claim.pageNumber,
          allocation,
        });
        providerStarted = true;
        providerStartedAtMs = this.clock().getTime();
        return provider.extractPage({
          pageNumber: claim.pageNumber,
          sourceSha256: claim.sourceSha256,
          fingerprint: claim.fingerprint,
          source: {
            filePath: page.filePath,
            bytes: page.bytes,
            readBytes: () => readFile(page.filePath),
          },
          heartbeat: () => this.workRepository.renew({
            tenantId,
            workUnitId: claim.workUnitId,
            leaseToken: claim.leaseToken,
            leaseMs: this.leaseMs,
          }),
        });
      });
      await this.recordCapacity({ tenantId, workloadClass, capability: claim.capability, providerStartedAtMs, outcome: "success" });
      capacityRecorded = true;
      if (admission.permit) this.admissionController.complete(admission.permit, { outcome: "success" });
    } catch (caught) {
      stopHeartbeat();
      if (providerStarted && !capacityRecorded) {
        await this.recordCapacity({
          tenantId, workloadClass, capability: claim.capability, providerStartedAtMs,
          outcome: admissionOutcome(caught).outcome === "throttled" ? "throttled" : "failed",
        });
      }
      if (admission.permit) {
        if (providerStarted) this.admissionController.complete(admission.permit, admissionOutcome(caught));
        else this.admissionController.cancel(admission.permit);
      }
      const error = normalizePreProviderFailure(caught);
      const failed = await this.workRepository.finishFailure({ tenantId, claim, error });
      const publications = failed.status === "review_required" ? await this.publishAffected(tenantId, failed) : [];
      return { workUnitId: claim.workUnitId, status: failed.status, errorCode: error.code, publications };
    }
    stopHeartbeat();
    let validation;
    try {
      validation = this.validator.validate(providerResult);
    } catch {
      const error = new Error("page validation failed after provider completion");
      error.code = "worker.validation_failed";
      error.retryable = false;
      error.billingKnown = true;
      error.billedCostUsd = providerResult.billedCostUsd;
      error.usage = providerResult.usage;
      const failed = await this.workRepository.finishFailure({ tenantId, claim, error });
      const publications = failed.status === "review_required" ? await this.publishAffected(tenantId, failed) : [];
      return { workUnitId: claim.workUnitId, status: failed.status, errorCode: error.code, publications };
    }
    const repair = this.repairRouter?.select({ claim, providerResult, validation }) || null;
    const completed = await this.workRepository.finishSuccess({ tenantId, claim, providerResult, validation, repair });
    const publications = completed.status === "repair_queued" ? [] : await this.publishAffected(tenantId, completed);
    return { workUnitId: claim.workUnitId, status: completed.status, publications };
  }

  async recordCapacity({ tenantId, workloadClass, capability, providerStartedAtMs, outcome }) {
    if (!this.capacityCalibration || !providerStartedAtMs) return null;
    const durationMs = Math.max(1, Math.round(this.clock().getTime() - providerStartedAtMs));
    try {
      return await this.capacityCalibration.recordProvider({
        tenantId, workloadClass, ...capability, pageOperations: 1, durationMs, outcome,
      });
    } catch {
      return null;
    }
  }

  async publishAffected(tenantId, checkpoint) {
    if (!this.resultRepository) return [];
    const publications = [];
    for (const intakeId of checkpoint.intakeIds || []) {
      try {
        const publication = await this.resultRepository.publishReadyIntake({ tenantId, intakeId });
        publications.push({ intakeId, published: Boolean(publication?.published), resultId: publication?.result?.resultId || "" });
      } catch (error) {
        publications.push({ intakeId, published: false, errorCode: String(error?.code || "result.publication_failed") });
      }
    }
    return publications;
  }

  async drainTenant({ tenantId, workerId = "postgres-document-worker", maximumClaims = 10_000 } = {}) {
    const outcomes = [];
    for (let index = 0; index < maximumClaims; index += 1) {
      const outcome = await this.runOnce({ tenantId, workerId });
      if (!outcome) break;
      outcomes.push(outcome);
      if (outcome.status === "deferred") break;
    }
    return outcomes;
  }

  startHeartbeat({ tenantId, claim }) {
    const intervalMs = Math.max(250, Math.min(10_000, Math.trunc(this.leaseMs / 3)));
    const timer = setInterval(() => {
      this.workRepository.renew({
        tenantId,
        workUnitId: claim.workUnitId,
        leaseToken: claim.leaseToken,
        leaseMs: this.leaseMs,
      }).catch(() => {});
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}

function normalizePreProviderFailure(error) {
  if (String(error?.code || "").startsWith("provider.")) return error;
  if (String(error?.code || "").startsWith("worker.") || String(error?.code || "").startsWith("scratch.")) {
    error.retryable = error.retryable === true;
    error.billingKnown = true;
    error.billedCostUsd = 0;
    error.usage = { inputUnits: 0, outputUnits: 0 };
    return error;
  }
  return measuredLocalError("worker failed before provider completion", "worker.local_failure");
}

function admissionOutcome(error) {
  const code = String(error?.code || "");
  if (code === "provider.http_429" || code === "provider.rate_limited") {
    return { outcome: "throttled", retryAfterMs: Number(error?.retryAfterMs || 0) };
  }
  return { outcome: "failed" };
}

function measuredLocalError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  error.billingKnown = true;
  error.billedCostUsd = 0;
  error.usage = { inputUnits: 0, outputUnits: 0 };
  return error;
}
