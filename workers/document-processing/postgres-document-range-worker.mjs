import { readFile } from "node:fs/promises";

import { providerCapabilityKey } from "../../services/document-intake-extraction/providers/pinned-provider-adapter.mjs";

export class PostgresDocumentRangeWorker {
  constructor({
    workRepository,
    resultRepository = null,
    objectStore,
    scratchSpace,
    pageMaterializer,
    providers = [],
    validator,
    repairRouter = null,
    admissionController = null,
    capacityCalibration = null,
    clock = () => new Date(),
    leaseMs = 60_000,
    maximumPages = 8,
  } = {}) {
    if (!workRepository?.claimDocumentLocalBatch || !workRepository?.renew || !workRepository?.finishSuccess || !workRepository?.finishFailure) {
      throw new Error("PostgreSQL range worker requires a document-local work repository");
    }
    if (!objectStore?.openBlobStream) throw new Error("PostgreSQL range worker requires a streaming object store");
    if (!scratchSpace?.withTaskScratch || !scratchSpace?.materializeBlob) throw new Error("PostgreSQL range worker requires bounded scratch");
    if (!pageMaterializer?.materializePageRange) throw new Error("PostgreSQL range worker requires a range materializer");
    if (!validator?.validate || !validator?.version) throw new Error("PostgreSQL range worker requires a versioned validator");
    if (repairRouter && !repairRouter.select) throw new Error("repairRouter.select is required");
    if (admissionController && (!admissionController.acquire || !admissionController.complete || !admissionController.cancel)) {
      throw new Error("admissionController requires acquire, complete, and cancel");
    }
    if (admissionController && providers.length !== 1) throw new Error("admission-controlled range workers require one dedicated provider capability");
    if (capacityCalibration && !capacityCalibration.recordProvider) throw new Error("capacityCalibration.recordProvider is required");
    this.workRepository = workRepository;
    this.resultRepository = resultRepository;
    this.objectStore = objectStore;
    this.scratchSpace = scratchSpace;
    this.pageMaterializer = pageMaterializer;
    if (!providers.length) throw new Error("PostgreSQL range worker requires at least one provider capability");
    this.providers = new Map(providers.map((provider) => [providerCapabilityKey(provider.capability), provider]));
    this.capabilities = providers.map((provider) => provider.capability);
    this.validator = validator;
    this.repairRouter = repairRouter;
    this.admissionController = admissionController;
    this.admissionCapability = providers[0]?.capability || null;
    this.capacityCalibration = capacityCalibration;
    this.clock = clock;
    this.leaseMs = boundedInteger(leaseMs, "leaseMs", 1_000, 15 * 60 * 1000);
    this.maximumPages = boundedInteger(maximumPages, "maximumPages", 1, 32);
  }

  async runOnce({ tenantId, workerId = "postgres-document-range-worker", workloadClass = "default" } = {}) {
    const admission = this.admissionController?.acquire(this.admissionCapability, { weight: this.maximumPages }) || { admitted: true, permit: null };
    if (!admission.admitted) return { status: "deferred", admissionReason: admission.reason, retryAfterMs: admission.retryAfterMs };
    let claims;
    try {
      claims = await this.workRepository.claimDocumentLocalBatch({
        tenantId, workerId, maximumPages: this.maximumPages, leaseMs: this.leaseMs, capabilities: this.capabilities,
      });
    } catch (error) {
      if (admission.permit) this.admissionController.cancel(admission.permit);
      throw error;
    }
    if (!claims.length) {
      if (admission.permit) this.admissionController.cancel(admission.permit);
      return null;
    }
    const capability = claims[0].capability;
    const provider = this.providers.get(providerCapabilityKey(capability));
    if (!provider?.extractPages) {
      if (admission.permit) this.admissionController.cancel(admission.permit);
      const error = measuredLocalError(`no range provider registered for ${capability.provider}/${capability.model}`, "worker.provider_unavailable");
      return this.finishFailures({ tenantId, claims, error });
    }
    const stopHeartbeat = this.startHeartbeat({ tenantId, claims });
    let providerResults;
    let providerStarted = false;
    let providerStartedAtMs = 0;
    let capacityRecorded = false;
    try {
      const maximumOutputBytes = Number(this.pageMaterializer.maximumRangeBytes || 0);
      providerResults = await this.scratchSpace.withTaskScratch({
        taskId: `range-${claims[0].workUnitId}`,
        expectedBytes: claims[0].sourceBytes + maximumOutputBytes,
      }, async (allocation) => {
        const source = await this.scratchSpace.materializeBlob({
          allocation,
          objectStore: this.objectStore,
          blobReference: claims[0].blobReference,
          fileName: "source/source.pdf",
        });
        const range = await this.pageMaterializer.materializePageRange({
          sourceFilePath: source.filePath,
          firstPage: claims[0].pageNumber,
          lastPage: claims.at(-1).pageNumber,
          allocation,
        });
        providerStarted = true;
        providerStartedAtMs = this.clock().getTime();
        return provider.extractPages({
          pageNumbers: claims.map((claim) => claim.pageNumber),
          sourceSha256: claims[0].sourceSha256,
          fingerprints: claims.map((claim) => claim.fingerprint),
          attemptNumber: Math.max(...claims.map((claim) => Number(claim.attemptCount) || 1)),
          source: {
            filePath: range.filePath,
            bytes: range.bytes,
            readBytes: () => readFile(range.filePath),
          },
          heartbeat: () => this.renewAll({ tenantId, claims }),
        });
      });
      if (!Array.isArray(providerResults) || providerResults.length !== claims.length) {
        throw measuredLocalError("range provider returned an invalid result count", "worker.provider_result_count_invalid");
      }
      await this.recordCapacity({ tenantId, workloadClass, capability, pageOperations: claims.length, providerStartedAtMs, outcome: "success" });
      capacityRecorded = true;
      if (admission.permit) this.admissionController.complete(admission.permit, { outcome: "success" });
    } catch (caught) {
      stopHeartbeat();
      if (providerStarted && !capacityRecorded) {
        await this.recordCapacity({
          tenantId, workloadClass, capability, pageOperations: claims.length, providerStartedAtMs,
          outcome: admissionOutcome(caught).outcome === "throttled" ? "throttled" : "failed",
        });
      }
      if (admission.permit) {
        if (providerStarted) this.admissionController.complete(admission.permit, admissionOutcome(caught));
        else this.admissionController.cancel(admission.permit);
      }
      return this.finishFailures({ tenantId, claims, error: normalizePreProviderFailure(caught) });
    }
    stopHeartbeat();
    const checkpoints = [];
    for (let index = 0; index < claims.length; index += 1) {
      const claim = claims[index];
      const providerResult = providerResults[index];
      try {
        const validation = this.validator.validate(providerResult);
        const repair = this.repairRouter?.select({ claim, providerResult, validation }) || null;
        checkpoints.push(await this.workRepository.finishSuccess({ tenantId, claim, providerResult, validation, repair }));
      } catch (caught) {
        const error = validationFailure(caught, providerResult);
        checkpoints.push(await this.workRepository.finishFailure({ tenantId, claim, error }));
      }
    }
    const publications = await this.publishAffected(tenantId, checkpoints.filter((checkpoint) => checkpoint.status !== "repair_queued"));
    return {
      workUnitIds: claims.map((claim) => claim.workUnitId),
      firstPage: claims[0].pageNumber,
      lastPage: claims.at(-1).pageNumber,
      statuses: checkpoints.map((checkpoint) => checkpoint.status),
      publications,
    };
  }

  async recordCapacity({ tenantId, workloadClass, capability, pageOperations, providerStartedAtMs, outcome }) {
    if (!this.capacityCalibration || !providerStartedAtMs) return null;
    const durationMs = Math.max(1, Math.round(this.clock().getTime() - providerStartedAtMs));
    try {
      return await this.capacityCalibration.recordProvider({
        tenantId, workloadClass, ...capability, pageOperations, durationMs, outcome,
      });
    } catch {
      return null;
    }
  }

  async finishFailures({ tenantId, claims, error }) {
    const allocations = allocateSharedFailure(error, claims.length);
    const checkpoints = [];
    for (let index = 0; index < claims.length; index += 1) {
      const repair = this.repairRouter?.selectForFailure?.({ claim: claims[index], error: allocations[index] }) || null;
      checkpoints.push(await this.workRepository.finishFailure({ tenantId, claim: claims[index], error: allocations[index], repair }));
    }
    const publications = await this.publishAffected(tenantId, checkpoints.filter((checkpoint) => checkpoint.status === "review_required"));
    return {
      workUnitIds: claims.map((claim) => claim.workUnitId),
      firstPage: claims[0].pageNumber,
      lastPage: claims.at(-1).pageNumber,
      statuses: checkpoints.map((checkpoint) => checkpoint.status),
      errorCode: String(error?.code || "worker.local_failure"),
      publications,
    };
  }

  async renewAll({ tenantId, claims }) {
    const results = await Promise.allSettled(claims.map((claim) => this.workRepository.renew({
      tenantId, workUnitId: claim.workUnitId, leaseToken: claim.leaseToken, leaseMs: this.leaseMs,
    })));
    if (results.some((result) => result.status === "rejected")) {
      const error = new Error("one or more document-range leases were lost");
      error.code = "worker.lease_lost";
      throw error;
    }
    return { renewed: claims.length };
  }

  startHeartbeat({ tenantId, claims }) {
    const intervalMs = Math.max(250, Math.min(10_000, Math.trunc(this.leaseMs / 3)));
    const timer = setInterval(() => this.renewAll({ tenantId, claims }).catch(() => {}), intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  async publishAffected(tenantId, checkpoints) {
    if (!this.resultRepository) return [];
    const intakeIds = new Set(checkpoints.flatMap((checkpoint) => checkpoint.intakeIds || []));
    const publications = [];
    for (const intakeId of intakeIds) {
      try {
        const publication = await this.resultRepository.publishReadyIntake({ tenantId, intakeId });
        publications.push({ intakeId, published: Boolean(publication?.published), resultId: publication?.result?.resultId || "" });
      } catch (error) {
        publications.push({ intakeId, published: false, errorCode: String(error?.code || "result.publication_failed") });
      }
    }
    return publications;
  }
}

function allocateSharedFailure(error, count) {
  const knownCost = Number.isFinite(Number(error?.billedCostUsd));
  const inputUnits = Number(error?.usage?.inputUnits);
  const outputUnits = Number(error?.usage?.outputUnits);
  return Array.from({ length: count }, () => {
    const allocated = new Error(String(error?.message || "Range provider call failed"));
    allocated.code = String(error?.code || "provider.failed");
    allocated.retryable = error?.retryable !== false;
    allocated.billingKnown = error?.billingKnown === true || knownCost;
    if (knownCost) allocated.billedCostUsd = Number(error.billedCostUsd) / count;
    allocated.usage = {
      inputUnits: Number.isFinite(inputUnits) ? inputUnits / count : undefined,
      outputUnits: Number.isFinite(outputUnits) ? outputUnits / count : undefined,
    };
    return allocated;
  });
}

function validationFailure(_caught, providerResult) {
  const error = new Error("page validation failed after provider completion");
  error.code = "worker.validation_failed";
  error.retryable = false;
  error.billingKnown = true;
  error.billedCostUsd = providerResult?.billedCostUsd || 0;
  error.usage = providerResult?.usage || { inputUnits: 0, outputUnits: 0 };
  return error;
}

function normalizePreProviderFailure(error) {
  if (String(error?.code || "").startsWith("provider.")) return error;
  if (String(error?.code || "").startsWith("worker.") || String(error?.code || "").startsWith("scratch.")) {
    if (error.billingKnown !== true && !Number.isFinite(Number(error.billedCostUsd))) {
      error.billingKnown = true;
      error.billedCostUsd = 0;
      error.usage = { inputUnits: 0, outputUnits: 0 };
    }
    error.retryable = error.retryable === true;
    return error;
  }
  return measuredLocalError("worker failed before provider completion", "worker.local_failure");
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

function admissionOutcome(error) {
  const code = String(error?.code || "");
  if (code === "provider.http_429" || code === "provider.rate_limited") {
    return { outcome: "throttled", retryAfterMs: Number(error?.retryAfterMs || 0) };
  }
  return { outcome: "failed" };
}

function boundedInteger(value, field, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  return number;
}
