import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSIONS,
  PIPELINE_VERSIONS,
  SERVICE_LIMITS,
  createPipelineFingerprint,
  validateCreateIntakeCommand,
} from "../../packages/extraction-contracts/index.mjs";
import { publishEligibleIntakes } from "./assembly.mjs";

export class DocumentIntakeExtractionService {
  constructor({
    controlPlane,
    objectStore,
    documentInspector,
    capabilityRouter,
    clock = () => new Date(),
    idFactory = (kind) => `${kind}_${randomUUID()}`,
    uploadAuthorizationTtlMs = 15 * 60 * 1000,
  } = {}) {
    if (!controlPlane?.read || !controlPlane?.transact) throw new Error("V4 service requires a control plane");
    if (!objectStore?.createUploadAuthorization || !objectStore?.commitAuthorizedUpload) throw new Error("V4 service requires an object store");
    if (!documentInspector?.inspect) throw new Error("V4 service requires a document inspector");
    if (!capabilityRouter?.select || !capabilityRouter?.version) throw new Error("V4 service requires a versioned capability router");
    this.controlPlane = controlPlane;
    this.objectStore = objectStore;
    this.documentInspector = documentInspector;
    this.capabilityRouter = capabilityRouter;
    this.clock = clock;
    this.idFactory = idFactory;
    this.uploadAuthorizationTtlMs = uploadAuthorizationTtlMs;
  }

  async initialize() {
    await Promise.all([this.controlPlane.initialize?.(), this.objectStore.initialize?.()]);
  }

  async createIntake(input = {}) {
    const command = validateCreateIntakeCommand(input);
    await this.initialize();
    const idempotencyIndex = indexKey(command.tenantId, command.idempotencyKey);
    const current = await this.controlPlane.read();
    const existingId = current.idempotencyKeys[idempotencyIndex];
    if (existingId) return presentIntake(current.intakes[existingId], true, { includeUploadAuthorizations: true });

    const now = this.clock();
    const intakeId = this.idFactory("intake");
    const files = [];
    for (const manifest of command.files) {
      const fileId = this.idFactory("file");
      const documentId = this.idFactory("document");
      const uploadAuthorization = await this.objectStore.createUploadAuthorization({
        tenantId: command.tenantId,
        intakeId,
        fileId,
        expectedBytes: manifest.expectedBytes,
        expiresAt: new Date(now.getTime() + this.uploadAuthorizationTtlMs),
      });
      files.push({
        fileId,
        documentId,
        manifest,
        status: "awaiting_upload",
        uploadAuthorization,
        custodyReceipt: null,
      });
    }
    const intake = {
      schemaVersion: CONTRACT_VERSIONS.intake,
      intakeId,
      tenantId: command.tenantId,
      matterId: command.matterId,
      idempotencyKey: command.idempotencyKey,
      clientRequestId: command.clientRequestId,
      workloadClass: command.workloadClass,
      status: "awaiting_upload",
      expectedFileCount: files.length,
      expectedBytes: command.expectedBytes,
      files,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      custodyCommittedAt: null,
      readyAt: null,
      resultId: null,
    };
    return this.controlPlane.transact((state) => {
      const concurrentExistingId = state.idempotencyKeys[idempotencyIndex];
      if (concurrentExistingId) return presentIntake(state.intakes[concurrentExistingId], true, { includeUploadAuthorizations: true });
      state.idempotencyKeys[idempotencyIndex] = intakeId;
      state.intakes[intakeId] = intake;
      return presentIntake(intake, false, { includeUploadAuthorizations: true });
    });
  }

  async commitFileCustody({ tenantId = "", intakeId, fileId, uploadToken } = {}) {
    const before = await this.requireIntake(intakeId);
    assertTenant(before, tenantId);
    const beforeFile = requireFile(before, fileId);
    if (beforeFile.status === "committed") return structuredClone(beforeFile.custodyReceipt);
    if (beforeFile.uploadAuthorization.token !== uploadToken) throw serviceError("upload token does not match this file", "intake.upload_token_mismatch");

    const objectReceipt = await this.objectStore.commitAuthorizedUpload({
      token: uploadToken,
      tenantId: before.tenantId,
      intakeId,
      fileId,
    });
    const snapshot = await this.controlPlane.read();
    const knownBlob = snapshot.blobs[objectReceipt.sha256];
    const inspection = knownBlob
      ? { pageCount: knownBlob.pageCount, inspectorVersion: knownBlob.inspectorVersion }
      : await this.documentInspector.inspect({ blobReference: objectReceipt.blobReference });
    const capabilities = [];
    for (let pageNumber = 1; pageNumber <= inspection.pageCount; pageNumber += 1) {
      capabilities.push(await this.capabilityRouter.select({
        tenantId: before.tenantId,
        matterId: before.matterId,
        intakeId,
        fileId,
        sourceSha256: objectReceipt.sha256,
        pageNumber,
      }));
    }
    const now = this.clock().toISOString();
    return this.controlPlane.transact((state) => {
      const intake = requireIntakeInState(state, intakeId);
      const file = requireFile(intake, fileId);
      if (file.status === "committed") return structuredClone(file.custodyReceipt);
      const projectedPages = Object.values(state.documents)
        .filter((document) => document.intakeId === intakeId)
        .reduce((count, document) => count + document.pageCount, 0) + inspection.pageCount;
      if (projectedPages > SERVICE_LIMITS.maximumPages) {
        throw serviceError(`intake exceeds the ${SERVICE_LIMITS.maximumPages}-page service envelope`, "intake.page_limit_exceeded");
      }

      const existingLogicalDocument = Object.values(state.documents).find((document) => (
        document.tenantId === intake.tenantId && document.sourceSha256 === objectReceipt.sha256
      ));
      const pageWorkUnitIds = [];
      let allComputationsReused = true;
      for (let pageNumber = 1; pageNumber <= inspection.pageCount; pageNumber += 1) {
        const capability = capabilities[pageNumber - 1];
        const fingerprint = createPipelineFingerprint({
          sourceSha256: objectReceipt.sha256,
          pageNumber,
          dedupScope: intake.tenantId,
          provider: capability.provider,
          model: capability.model,
          adapterVersion: capability.adapterVersion,
          routingPolicy: this.capabilityRouter.version,
          validator: PIPELINE_VERSIONS.validator,
        });
        let workUnitId = state.workUnitByFingerprint[fingerprint];
        if (!workUnitId) {
          allComputationsReused = false;
          workUnitId = this.idFactory("pagework");
          state.workUnitByFingerprint[fingerprint] = workUnitId;
          state.workUnits[workUnitId] = {
            schemaVersion: CONTRACT_VERSIONS.pageWorkUnit,
            workUnitId,
            fingerprint,
            tenantId: intake.tenantId,
            sourceSha256: objectReceipt.sha256,
            blobReference: objectReceipt.blobReference,
            pageNumber,
            capability,
            routingPolicy: this.capabilityRouter.version,
            validatorVersion: PIPELINE_VERSIONS.validator,
            status: "queued",
            attemptCount: 0,
            maximumAttempts: 3,
            lease: null,
            output: null,
            logicalDocumentIds: [],
            createdAt: now,
            updatedAt: now,
          };
        }
        const work = state.workUnits[workUnitId];
        if (!work.logicalDocumentIds.includes(file.documentId)) work.logicalDocumentIds.push(file.documentId);
        pageWorkUnitIds.push(workUnitId);
      }
      state.documents[file.documentId] = {
        documentId: file.documentId,
        fileId,
        intakeId,
        tenantId: intake.tenantId,
        matterId: intake.matterId,
        originalName: file.manifest.originalName,
        relativePath: file.manifest.relativePath,
        sourceSha256: objectReceipt.sha256,
        sourceBytes: objectReceipt.bytes,
        blobReference: objectReceipt.blobReference,
        pageCount: inspection.pageCount,
        inspectorVersion: inspection.inspectorVersion,
        duplicateOfDocumentId: existingLogicalDocument?.documentId || "",
        pageWorkUnitIds,
        createdAt: now,
      };
      const blob = state.blobs[objectReceipt.sha256] || {
        sourceSha256: objectReceipt.sha256,
        bytes: objectReceipt.bytes,
        blobReference: objectReceipt.blobReference,
        pageCount: inspection.pageCount,
        inspectorVersion: inspection.inspectorVersion,
        logicalReferenceCount: 0,
        tenantIds: [],
        createdAt: now,
      };
      blob.logicalReferenceCount += 1;
      if (!blob.tenantIds.includes(intake.tenantId)) blob.tenantIds.push(intake.tenantId);
      state.blobs[objectReceipt.sha256] = blob;

      const receipt = {
        ...objectReceipt,
        schemaVersion: CONTRACT_VERSIONS.custodyReceipt,
        pageCount: inspection.pageCount,
        duplicateComputationReused: Boolean(existingLogicalDocument) && allComputationsReused,
        duplicateOfDocumentId: existingLogicalDocument?.documentId || "",
        committedAt: now,
      };
      file.status = "committed";
      file.custodyReceipt = receipt;
      intake.status = "uploading_with_speculative_processing";
      intake.updatedAt = now;
      return structuredClone(receipt);
    });
  }

  async commitBatchCustody({ tenantId = "", intakeId } = {}) {
    const now = this.clock().toISOString();
    return this.controlPlane.transact((state) => {
      const intake = requireIntakeInState(state, intakeId);
      assertTenant(intake, tenantId);
      const incomplete = intake.files.filter((file) => file.status !== "committed");
      if (incomplete.length) throw serviceError(`${incomplete.length} intake file(s) have not reached custody`, "intake.files_incomplete");
      if (!intake.custodyCommittedAt) {
        intake.custodyCommittedAt = now;
        intake.status = "processing";
        intake.updatedAt = now;
      }
      publishEligibleIntakes(state, { now, idFactory: this.idFactory });
      return presentIntake(intake, Boolean(intake.custodyCommittedAt));
    });
  }

  async getIntake(input) {
    const { tenantId, resourceId: intakeId } = normalizeResourceInput(input, "intakeId");
    const intake = await this.requireIntake(intakeId);
    assertTenant(intake, tenantId);
    return presentIntake(intake, true);
  }

  async getResult(input) {
    const { tenantId, resourceId: resultId } = normalizeResourceInput(input, "resultId");
    const state = await this.controlPlane.read();
    const result = state.results[resultId];
    if (!result || (tenantId && result.tenantId !== tenantId)) throw serviceError("extraction result not found", "intake.result_not_found");
    return structuredClone(result);
  }

  async getEvidence({ intakeId } = {}) {
    const state = await this.controlPlane.read();
    const intake = requireIntakeInState(state, intakeId);
    const documentIds = new Set(intake.files.map((file) => file.documentId));
    const workUnitIds = new Set(Object.values(state.workUnits)
      .filter((work) => work.logicalDocumentIds.some((id) => documentIds.has(id)))
      .map((work) => work.workUnitId));
    const attemptIds = new Set(state.attempts.filter((attempt) => workUnitIds.has(attempt.workUnitId)).map((attempt) => attempt.attemptId));
    return {
      intake: presentIntake(intake, true),
      documents: Object.values(state.documents).filter((document) => documentIds.has(document.documentId)),
      workUnits: Object.values(state.workUnits).filter((work) => workUnitIds.has(work.workUnitId)),
      attempts: state.attempts.filter((attempt) => attemptIds.has(attempt.attemptId)),
      costEvents: state.costEvents.filter((event) => attemptIds.has(event.attemptId)),
      events: state.events.filter((event) => event.intakeId === intakeId),
      result: intake.resultId ? state.results[intake.resultId] : null,
    };
  }

  async requireIntake(intakeId) {
    const state = await this.controlPlane.read();
    return structuredClone(requireIntakeInState(state, intakeId));
  }
}

function presentIntake(intake, idempotent, { includeUploadAuthorizations = false } = {}) {
  if (!intake) return null;
  const presented = structuredClone(intake);
  if (!includeUploadAuthorizations) {
    presented.files = presented.files.map(({ uploadAuthorization: _authorization, ...file }) => file);
  }
  return { ...presented, idempotent: Boolean(idempotent) };
}

function requireIntakeInState(state, intakeId) {
  const intake = state.intakes[String(intakeId || "")];
  if (!intake) throw serviceError("intake not found", "intake.not_found");
  return intake;
}

function requireFile(intake, fileId) {
  const file = intake.files.find((candidate) => candidate.fileId === fileId);
  if (!file) throw serviceError("intake file not found", "intake.file_not_found");
  return file;
}

function indexKey(tenantId, idempotencyKey) {
  return `${tenantId}\u0000${idempotencyKey}`;
}

function normalizeResourceInput(input, field) {
  if (input && typeof input === "object") {
    return { tenantId: String(input.tenantId || ""), resourceId: String(input[field] || "") };
  }
  return { tenantId: "", resourceId: String(input || "") };
}

function assertTenant(resource, tenantId) {
  if (tenantId && resource.tenantId !== tenantId) throw serviceError("resource not found", "intake.not_found");
}

function serviceError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
