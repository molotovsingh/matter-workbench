import {
  PIPELINE_VERSIONS,
  createPipelineFingerprint,
} from "../../../packages/extraction-contracts/index.mjs";

export class PostgresDocumentIntakeExtractionService {
  constructor({
    intakeRepository,
    resultRepository,
    objectStore,
    documentInspector,
    capabilityRouter,
    clock = () => new Date(),
    uploadAuthorizationTtlMs = 15 * 60 * 1000,
  } = {}) {
    if (!intakeRepository?.createIntake || !intakeRepository?.readIntake || !intakeRepository?.recordInspectedDocument) {
      throw new Error("PostgreSQL service requires an intake repository");
    }
    if (!resultRepository?.publishReadyIntake || !resultRepository?.readResult) throw new Error("PostgreSQL service requires a result repository");
    if (!objectStore?.createUploadAuthorization || !objectStore?.commitAuthorizedUpload) throw new Error("PostgreSQL service requires an object store");
    if (!documentInspector?.inspect) throw new Error("PostgreSQL service requires a document inspector");
    if (!capabilityRouter?.select || !capabilityRouter?.version) throw new Error("PostgreSQL service requires a versioned capability router");
    this.intakeRepository = intakeRepository;
    this.resultRepository = resultRepository;
    this.objectStore = objectStore;
    this.documentInspector = documentInspector;
    this.capabilityRouter = capabilityRouter;
    this.clock = clock;
    this.uploadAuthorizationTtlMs = uploadAuthorizationTtlMs;
  }

  async initialize() {
    await this.objectStore.initialize?.();
  }

  async createIntake(command = {}) {
    await this.initialize();
    const intake = await this.intakeRepository.createIntake(command);
    const expiresAt = new Date(this.clock().getTime() + this.uploadAuthorizationTtlMs);
    const files = [];
    for (const file of intake.files) {
      if (file.status !== "awaiting_upload") {
        files.push(file);
        continue;
      }
      const uploadAuthorization = await this.objectStore.createUploadAuthorization({
        tenantId: intake.tenantId,
        intakeId: intake.intakeId,
        fileId: file.fileId,
        expectedBytes: file.expectedBytes,
        mimeType: file.mimeType,
        expiresAt,
      });
      files.push({ ...file, uploadAuthorization });
    }
    return { ...intake, files };
  }

  async getIntake(input) {
    const { tenantId, intakeId } = normalizeTenantResource(input, "intakeId");
    return this.intakeRepository.readIntake({ tenantId, intakeId });
  }

  async commitFileCustody({ tenantId, intakeId, fileId, uploadToken } = {}) {
    const intake = await this.intakeRepository.readIntake({ tenantId, intakeId });
    const file = intake.files.find((candidate) => candidate.fileId === fileId);
    if (!file) throw serviceError("intake file not found", "intake.file_not_found");
    const receipt = await this.objectStore.commitAuthorizedUpload({ token: uploadToken, tenantId, intakeId, fileId });
    const inspection = await this.documentInspector.inspect({ blobReference: receipt.blobReference, sourceBytes: receipt.bytes });
    const routedPages = [];
    for (let pageNumber = 1; pageNumber <= inspection.pageCount; pageNumber += 1) {
      const capability = await this.capabilityRouter.select({
        tenantId,
        matterId: intake.matterId,
        intakeId,
        fileId,
        sourceSha256: receipt.sha256,
        pageNumber,
      });
      routedPages.push({
        pageNumber,
        fingerprint: createPipelineFingerprint({
          sourceSha256: receipt.sha256,
          pageNumber,
          dedupScope: tenantId,
          provider: capability.provider,
          model: capability.model,
          adapterVersion: capability.adapterVersion,
          routingPolicy: this.capabilityRouter.version,
          validator: PIPELINE_VERSIONS.validator,
        }),
        capability,
        routingPolicy: this.capabilityRouter.version,
        validatorVersion: PIPELINE_VERSIONS.validator,
        priority: 0,
        weight: 1,
        virtualFinish: pageNumber,
      });
    }
    await this.intakeRepository.recordInspectedDocument({
      tenantId,
      intakeId,
      fileId,
      sourceSha256: receipt.sha256,
      pageCount: inspection.pageCount,
      inspectorVersion: inspection.inspectorVersion,
      pages: routedPages,
    });
    return {
      ...receipt,
      pageCount: inspection.pageCount,
      inspectorVersion: inspection.inspectorVersion,
    };
  }

  async commitBatchCustody({ tenantId, intakeId } = {}) {
    const committed = await this.intakeRepository.commitBatchCustody({ tenantId, intakeId });
    const publication = await this.resultRepository.publishReadyIntake({ tenantId, intakeId });
    if (publication?.result) return this.intakeRepository.readIntake({ tenantId, intakeId });
    return committed;
  }

  async getResult(input) {
    const { tenantId, resultId } = normalizeTenantResource(input, "resultId");
    return this.resultRepository.readResult({ tenantId, resultId });
  }
}

function normalizeTenantResource(input, resourceField) {
  if (!input || typeof input !== "object") throw new Error(`tenantId and ${resourceField} are required`);
  const tenantId = String(input.tenantId || "").trim();
  const resource = String(input[resourceField] || "").trim();
  if (!tenantId || !resource) throw new Error(`tenantId and ${resourceField} are required`);
  return { tenantId, [resourceField]: resource };
}

function serviceError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
