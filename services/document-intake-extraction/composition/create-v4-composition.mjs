import { assertPinnedProviderCapability } from "../../../packages/extraction-contracts/index.mjs";
import { createPageValidator } from "../page-validator.mjs";
import { RollingCapacityCalibration } from "../capacity/rolling-capacity-calibration.mjs";
import { IntakeProgressService } from "../progress/intake-progress-service.mjs";
import { OutboxDispatcher } from "../events/outbox-dispatcher.mjs";
import { createDocumentIntakeExtractionHttpHandler } from "../http/document-intake-extraction-http.mjs";
import { PostgresDocumentIntakeExtractionService } from "../postgres/postgres-document-intake-extraction-service.mjs";
import { PostgresIntakeRepository } from "../postgres/postgres-intake-repository.mjs";
import { PostgresOutboxStore } from "../postgres/postgres-outbox-store.mjs";
import { PostgresResultRepository } from "../postgres/postgres-result-repository.mjs";
import { PostgresUploadAuthorizationStore } from "../postgres/postgres-upload-authorization-store.mjs";
import { PostgresWorkRepository } from "../postgres/postgres-work-repository.mjs";
import { createSelectiveRepairRouter } from "../routing/selective-repair-router.mjs";
import { PostgresDocumentProcessingWorker } from "../../../workers/document-processing/postgres-document-processing-worker.mjs";
import { PostgresDocumentRangeWorker } from "../../../workers/document-processing/postgres-document-range-worker.mjs";

export function createDocumentIntakeExtractionV4Composition({
  pool,
  objectStoreFactory,
  documentInspectorFactory,
  primaryProvider,
  repairProvider,
  calibration = new RollingCapacityCalibration(),
  providerStages = [],
  workerCapacity = {},
  validator = createPageValidator(),
  admissionController = null,
  clock = () => new Date(),
} = {}) {
  if (!pool?.connect) throw new Error("V4 composition requires a PostgreSQL pool");
  if (typeof objectStoreFactory !== "function") throw new Error("V4 composition requires an objectStoreFactory");
  if (typeof documentInspectorFactory !== "function") throw new Error("V4 composition requires a documentInspectorFactory");
  if (!primaryProvider?.capability || typeof primaryProvider.extractPages !== "function") {
    throw new Error("V4 composition requires a document-range primary provider");
  }
  if (!repairProvider?.capability || typeof repairProvider.extractPage !== "function") {
    throw new Error("V4 composition requires a page repair provider");
  }
  const primaryCapability = assertPinnedProviderCapability(primaryProvider.capability);
  assertPinnedProviderCapability(repairProvider.capability);
  const intakeRepository = new PostgresIntakeRepository({ pool, clock });
  const resultRepository = new PostgresResultRepository({ pool, clock });
  const workRepository = new PostgresWorkRepository({ pool, clock });
  const outboxStore = new PostgresOutboxStore({ pool, clock });
  const uploadAuthorizationStore = new PostgresUploadAuthorizationStore({ pool, clock });
  const objectStore = objectStoreFactory({ authorizationStore: uploadAuthorizationStore });
  if (!objectStore?.createUploadAuthorization || !objectStore?.commitAuthorizedUpload || !objectStore?.openBlobStream) {
    throw new Error("objectStoreFactory must return direct custody and streaming methods");
  }
  const documentInspector = documentInspectorFactory({ objectStore });
  if (!documentInspector?.inspect) throw new Error("documentInspectorFactory must return inspect");
  const capabilityRouter = Object.freeze({
    version: "mistral-ocr41-document-range-primary/v1",
    select: () => primaryCapability,
  });
  const repairRouter = createSelectiveRepairRouter({ repairProvider });
  const progressService = new IntakeProgressService({
    intakeRepository, calibration, providerStages, workerCapacity, clock,
  });
  const service = new PostgresDocumentIntakeExtractionService({
    intakeRepository,
    resultRepository,
    objectStore,
    documentInspector,
    capabilityRouter,
    progressService,
    clock,
  });

  return Object.freeze({
    service,
    repositories: Object.freeze({ intakeRepository, resultRepository, workRepository, outboxStore, uploadAuthorizationStore }),
    objectStore,
    calibration,
    validator,
    capabilityRouter,
    repairRouter,
    createHttpHandler({ authenticate, authorizeMatter, maximumBodyBytes } = {}) {
      return createDocumentIntakeExtractionHttpHandler({ service, authenticate, authorizeMatter, maximumBodyBytes });
    },
    createRangeWorker({ scratchSpace, pageMaterializer, leaseMs, maximumPages } = {}) {
      return new PostgresDocumentRangeWorker({
        workRepository,
        resultRepository,
        objectStore,
        scratchSpace,
        pageMaterializer,
        providers: [primaryProvider],
        validator,
        repairRouter,
        admissionController,
        leaseMs,
        maximumPages,
      });
    },
    createRepairWorker({ scratchSpace, pageMaterializer, leaseMs } = {}) {
      return new PostgresDocumentProcessingWorker({
        workRepository,
        resultRepository,
        objectStore,
        scratchSpace,
        pageMaterializer,
        providers: [repairProvider],
        validator,
        repairRouter,
        admissionController,
        leaseMs,
      });
    },
    createOutboxDispatcher({ deliver, baseRetryMs, maximumRetryMs } = {}) {
      return new OutboxDispatcher({ store: outboxStore, deliver, baseRetryMs, maximumRetryMs });
    },
  });
}
