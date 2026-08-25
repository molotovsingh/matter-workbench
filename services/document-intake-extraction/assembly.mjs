import {
  CONTRACT_VERSIONS,
  PIPELINE_VERSIONS,
  assertExtractionResultContract,
  assertReadyEventContract,
} from "../../packages/extraction-contracts/index.mjs";

const TERMINAL_WORK = new Set(["accepted", "review_required"]);

export function publishEligibleIntakes(state, { now, idFactory } = {}) {
  const published = [];
  for (const intake of Object.values(state.intakes)) {
    if (!intake.custodyCommittedAt || intake.resultId) continue;
    const documents = intake.files.map((file) => state.documents[file.documentId]).filter(Boolean);
    if (documents.length !== intake.files.length) continue;
    const workUnits = documents.flatMap((document) => document.pageWorkUnitIds.map((id) => state.workUnits[id]));
    if (workUnits.some((work) => !work || !TERMINAL_WORK.has(work.status))) continue;

    const resultId = idFactory("result");
    const resultDocuments = documents.map((document) => ({
      documentId: document.documentId,
      fileId: document.fileId,
      originalName: document.originalName,
      relativePath: document.relativePath,
      sourceSha256: document.sourceSha256,
      sourceBytes: document.sourceBytes,
      duplicateOfDocumentId: document.duplicateOfDocumentId || "",
      pageCount: document.pageCount,
      pages: document.pageWorkUnitIds.map((workUnitId) => pageOutcome(state.workUnits[workUnitId])),
    }));
    const reviewPageCount = resultDocuments.reduce(
      (count, document) => count + document.pages.filter((page) => page.outcome === "review_required").length,
      0,
    );
    const result = {
      schemaVersion: CONTRACT_VERSIONS.extractionResult,
      resultId,
      intakeId: intake.intakeId,
      tenantId: intake.tenantId,
      matterId: intake.matterId,
      version: 1,
      status: reviewPageCount ? "ready_with_review" : "ready",
      assemblerVersion: PIPELINE_VERSIONS.assembler,
      custodyCommittedAt: intake.custodyCommittedAt,
      createdAt: now,
      documentCount: resultDocuments.length,
      pageCount: resultDocuments.reduce((count, document) => count + document.pageCount, 0),
      reviewPageCount,
      documents: resultDocuments,
    };
    assertExtractionResultContract(result);
    state.results[resultId] = result;
    intake.resultId = resultId;
    intake.status = result.status;
    intake.readyAt = now;

    const event = {
      schemaVersion: CONTRACT_VERSIONS.event,
      type: "extraction.result.ready",
      eventId: idFactory("event"),
      tenantId: intake.tenantId,
      matterId: intake.matterId,
      intakeId: intake.intakeId,
      resultId,
      resultVersion: result.version,
      resultStatus: result.status,
      documentCount: result.documentCount,
      pageCount: result.pageCount,
      reviewPageCount,
      occurredAt: now,
      deliveryStatus: "pending",
    };
    assertReadyEventContract(event);
    state.events.push(event);
    published.push({ intakeId: intake.intakeId, resultId, eventId: event.eventId });
  }
  return published;
}

function pageOutcome(work) {
  const output = work.output || {};
  return {
    pageNumber: work.pageNumber,
    outcome: work.status,
    text: String(output.text || ""),
    reviewReasons: Array.isArray(output.reviewReasons) ? output.reviewReasons : [],
    provenance: {
      sourceSha256: work.sourceSha256,
      fingerprint: work.fingerprint,
      provider: work.capability.provider,
      model: work.capability.model,
      adapterVersion: work.capability.adapterVersion,
      routingPolicy: work.routingPolicy,
      validatorVersion: output.validatorVersion,
      attemptId: output.attemptId || "",
    },
  };
}
