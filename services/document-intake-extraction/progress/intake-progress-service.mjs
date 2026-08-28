import { CONTRACT_VERSIONS } from "../../../packages/extraction-contracts/index.mjs";
import { planWorkloadCapacity } from "../capacity/workload-capacity-planner.mjs";

const TERMINAL = new Set(["accepted", "review_required"]);

export class IntakeProgressService {
  constructor({ intakeRepository, calibration, providerStages = [], workerCapacity = {}, clock = () => new Date() } = {}) {
    if (!intakeRepository?.readProgressSnapshot) throw new Error("progress service requires intakeRepository.readProgressSnapshot");
    if (!calibration?.forTenant && (!calibration?.estimateCorpus || !calibration?.estimateProvider)) {
      throw new Error("progress service requires rolling or tenant-scoped capacity calibration");
    }
    this.intakeRepository = intakeRepository;
    this.calibration = calibration;
    this.providerStages = providerStages;
    this.workerCapacity = workerCapacity;
    this.clock = clock;
  }

  async getProgress({ tenantId, intakeId, workloadClass = "", uploadBytesPerSecond = 0 } = {}) {
    const snapshot = await this.intakeRepository.readProgressSnapshot({ tenantId, intakeId });
    const intake = snapshot.intake;
    const effectiveWorkloadClass = workloadClass || intake.workloadClass || "mixed_legal";
    const calibration = this.calibration.forTenant ? await this.calibration.forTenant(tenantId) : this.calibration;
    const corpus = calibration.estimateCorpus(effectiveWorkloadClass);
    const currentWeight = snapshot.work.reduce((sum, row) => sum + row.weight, 0);
    const completedWeight = snapshot.work.filter((row) => TERMINAL.has(row.status)).reduce((sum, row) => sum + row.weight, 0);
    const runningWeight = snapshot.work.filter((row) => row.status === "running").reduce((sum, row) => sum + row.weight, 0);
    const providerStages = this.providerStages.map((stage) => {
      const estimate = calibration.estimateProvider(stage, stage.fallback || {});
      const observedWeight = snapshot.work
        .filter((row) => row.provider === stage.provider && row.model === stage.model && row.adapterVersion === stage.adapterVersion)
        .reduce((sum, row) => sum + row.weight, 0);
      const observedShare = currentWeight > 0 ? observedWeight / currentWeight : undefined;
      return {
        ...stage,
        workShare: observedShare ?? stage.workShare,
        pageOperationsPerSecond: estimate.pageOperationsPerSecond.median,
        conservativePageOperationsPerSecond: estimate.pageOperationsPerSecond.conservative,
        optimisticPageOperationsPerSecond: estimate.pageOperationsPerSecond.optimistic,
        throttleRate: estimate.throttleRate,
        failureRate: estimate.failureRate,
        sampleCount: estimate.sampleCount,
      };
    });
    const plan = planWorkloadCapacity({
      workload: {
        expectedFiles: intake.expectedFileCount,
        expectedBytes: intake.expectedBytes,
        committedFiles: intake.committedFileCount,
        committedBytes: intake.committedBytes,
        observedPages: intake.observedPageCount,
        completedPageOperations: completedWeight,
        uploadBytesPerSecond,
      },
      corpusEstimate: corpus,
      providerStages,
      queue: { weightedPageOperations: snapshot.queueWeightedPageOperations },
      workers: this.workerCapacity,
    });
    const ready = ["ready", "ready_with_review"].includes(intake.status);
    if (ready) {
      plan.processingEta.lowerSeconds = 0;
      plan.processingEta.upperSeconds = 0;
      plan.processingEta.sloState = "complete";
    }
    const now = this.clock();
    const custodyElapsedSeconds = intake.custodyCommittedAt
      ? Math.max(0, (now.getTime() - new Date(intake.custodyCommittedAt).getTime()) / 1000)
      : null;
    const reasons = new Set(ready ? [] : plan.exception.reasons);
    if (!ready && custodyElapsedSeconds !== null && custodyElapsedSeconds > 120) reasons.add("processing_objective_breached");
    const uploadRemainingBytes = Math.max(0, intake.expectedBytes - intake.committedBytes);
    return {
      schemaVersion: CONTRACT_VERSIONS.progress,
      intakeId,
      tenantId,
      status: intake.status,
      workloadClass: effectiveWorkloadClass,
      updatedAt: now.toISOString(),
      upload: {
        committedFiles: intake.committedFileCount,
        expectedFiles: intake.expectedFileCount,
        committedBytes: intake.committedBytes,
        expectedBytes: intake.expectedBytes,
        remainingBytes: uploadRemainingBytes,
        etaSeconds: uploadBytesPerSecond > 0 ? Math.ceil(uploadRemainingBytes / uploadBytesPerSecond) : null,
      },
      processing: {
        observedLogicalPages: intake.observedPageCount,
        currentWeightedOperations: currentWeight,
        completedWeightedOperations: completedWeight,
        runningWeightedOperations: runningWeight,
        completionRatio: currentWeight > 0 ? completedWeight / currentWeight : ready ? 1 : 0,
        custodyCommittedAt: intake.custodyCommittedAt,
        custodyElapsedSeconds,
        eta: plan.processingEta,
      },
      capacity: {
        workers: plan.workers,
        providers: plan.providers,
        uploadScaleWindow: plan.uploadScaleWindow,
      },
      exception: { active: reasons.size > 0, reasons: Array.from(reasons) },
    };
  }
}
