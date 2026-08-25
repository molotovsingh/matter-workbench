import { createHash } from "node:crypto";

import { assertPinnedProviderCapability, canonicalJson } from "../../../packages/extraction-contracts/index.mjs";

export const DOCUMENT_LOCAL_TASK_POLICY = "document-local-provider-task-planner/v1";

export function planDocumentLocalProviderTasks({
  documents = [],
  maximumPagesPerTask = 8,
  maximumBytesPerTask = 32 * 1024 * 1024,
  maximumEstimatedSecondsPerTask = 3,
  estimatedPageOperationsPerSecond = 4,
  policyVersion = DOCUMENT_LOCAL_TASK_POLICY,
} = {}) {
  const maxPages = positiveInteger(maximumPagesPerTask, "maximumPagesPerTask");
  const maxBytes = positiveInteger(maximumBytesPerTask, "maximumBytesPerTask");
  const maxSeconds = positiveNumber(maximumEstimatedSecondsPerTask, "maximumEstimatedSecondsPerTask");
  const operationsPerSecond = positiveNumber(estimatedPageOperationsPerSecond, "estimatedPageOperationsPerSecond");
  const tasks = [];
  for (const [documentIndex, document] of documents.entries()) {
    const documentId = requiredText(document.documentId, `documents[${documentIndex}].documentId`);
    const sourceSha256 = requiredSha(document.sourceSha256, `documents[${documentIndex}].sourceSha256`);
    const pages = normalizePages(document.pages, documentIndex);
    let current = [];
    for (const page of pages) {
      if (page.status && page.status !== "queued") {
        flush();
        continue;
      }
      const capability = assertPinnedProviderCapability(page.capability);
      const capabilityKey = capabilityIdentity(capability);
      const previous = current.at(-1);
      const projectedPages = current.length + 1;
      const projectedBytes = current.reduce((sum, unit) => sum + unit.bytes, 0) + page.bytes;
      const projectedSeconds = current.reduce((sum, unit) => sum + unit.weight, 0) / operationsPerSecond + page.weight / operationsPerSecond;
      const incompatible = previous && (
        page.pageNumber !== previous.pageNumber + 1
        || capabilityKey !== previous.capabilityKey
        || projectedPages > maxPages
        || projectedBytes > maxBytes
        || projectedSeconds > maxSeconds
      );
      if (incompatible) flush();
      current.push({ ...page, capability, capabilityKey });
    }
    flush();

    function flush() {
      if (!current.length) return;
      const units = current;
      current = [];
      const bytes = units.reduce((sum, unit) => sum + unit.bytes, 0);
      const weight = units.reduce((sum, unit) => sum + unit.weight, 0);
      const capability = units[0].capability;
      const identity = {
        policyVersion,
        documentId,
        sourceSha256,
        capability,
        units: units.map((unit) => ({
          pageNumber: unit.pageNumber,
          workUnitId: unit.workUnitId,
          fingerprint: unit.fingerprint,
        })),
      };
      tasks.push({
        taskId: `provider-task-${createHash("sha256").update(canonicalJson(identity)).digest("hex").slice(0, 24)}`,
        policyVersion,
        tenantId: requiredText(document.tenantId, `documents[${documentIndex}].tenantId`),
        matterId: requiredText(document.matterId, `documents[${documentIndex}].matterId`),
        intakeId: requiredText(document.intakeId, `documents[${documentIndex}].intakeId`),
        documentId,
        sourceSha256,
        capability,
        pageStart: units[0].pageNumber,
        pageEnd: units.at(-1).pageNumber,
        pageCount: units.length,
        bytes,
        weight,
        estimatedSeconds: weight / operationsPerSecond,
        oversizeSinglePage: units.length === 1 && (bytes > maxBytes || weight / operationsPerSecond > maxSeconds),
        units: units.map(({ capabilityKey: _key, capability: _capability, ...unit }) => unit),
      });
    }
  }
  return tasks;
}

function normalizePages(input, documentIndex) {
  if (!Array.isArray(input) || !input.length) throw new Error(`documents[${documentIndex}].pages must not be empty`);
  const pages = input.map((page, pageIndex) => ({
    pageNumber: positiveInteger(page.pageNumber, `documents[${documentIndex}].pages[${pageIndex}].pageNumber`),
    workUnitId: requiredText(page.workUnitId, `documents[${documentIndex}].pages[${pageIndex}].workUnitId`),
    fingerprint: requiredSha(page.fingerprint, `documents[${documentIndex}].pages[${pageIndex}].fingerprint`),
    bytes: positiveInteger(page.bytes, `documents[${documentIndex}].pages[${pageIndex}].bytes`),
    weight: positiveNumber(page.weight, `documents[${documentIndex}].pages[${pageIndex}].weight`, 1),
    status: String(page.status || "queued"),
    capability: page.capability,
  })).sort((left, right) => left.pageNumber - right.pageNumber);
  const seen = new Set();
  for (const page of pages) {
    if (seen.has(page.pageNumber)) throw new Error(`document ${documentIndex} contains duplicate page ${page.pageNumber}`);
    seen.add(page.pageNumber);
  }
  return pages;
}

function capabilityIdentity(capability) {
  return `${capability.provider}\u0000${capability.model}\u0000${capability.adapterVersion}`;
}

function requiredText(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function requiredSha(value, field) {
  const normalized = String(value || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${field} must be SHA-256`);
  return normalized;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${field} must be a positive integer`);
  return number;
}

function positiveNumber(value, field, fallback) {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be positive`);
  return number;
}
