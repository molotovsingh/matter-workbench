import assert from "node:assert/strict";
import test from "node:test";

import { planDocumentLocalProviderTasks } from "../services/document-intake-extraction/scheduling/document-local-task-planner.mjs";
import { admitScheduledTasks, scheduleWeightedFair } from "../services/document-intake-extraction/scheduling/weighted-fair-scheduler.mjs";

const CAPABILITY = { provider: "mistral", model: "mistral-ocr-4-1", adapterVersion: "adapter/v1" };
const REPAIR = { provider: "gemini", model: "gemini-3.7-flash", adapterVersion: "adapter/v1" };

// V4-SCHEDULE-001
test("V4-SCHEDULE-001 creates bounded contiguous same-document provider tasks without mixing capabilities or documents", () => {
  const tasks = planDocumentLocalProviderTasks({
    documents: [
      document("doc-a", "a", [
        page(1, CAPABILITY, 100), page(2, CAPABILITY, 100), page(3, CAPABILITY, 100),
        page(4, CAPABILITY, 100, { status: "accepted" }),
        page(5, CAPABILITY, 100), page(6, REPAIR, 100),
      ]),
      document("doc-b", "b", [page(1, CAPABILITY, 500), page(2, CAPABILITY, 500)]),
    ],
    maximumPagesPerTask: 2,
    maximumBytesPerTask: 600,
    maximumEstimatedSecondsPerTask: 2,
    estimatedPageOperationsPerSecond: 2,
  });
  assert.deepEqual(tasks.map((task) => [task.documentId, task.pageStart, task.pageEnd, task.capability.provider]), [
    ["doc-a", 1, 2, "mistral"],
    ["doc-a", 3, 3, "mistral"],
    ["doc-a", 5, 5, "mistral"],
    ["doc-a", 6, 6, "gemini"],
    ["doc-b", 1, 1, "mistral"],
    ["doc-b", 2, 2, "mistral"],
  ]);
  assert.ok(tasks.every((task) => task.units.every((unit) => unit.pageNumber >= task.pageStart && unit.pageNumber <= task.pageEnd)));
  assert.equal(new Set(tasks.map((task) => task.taskId)).size, tasks.length);
  assert.ok(tasks.every((task) => task.pageCount <= 2));

  const oversize = planDocumentLocalProviderTasks({
    documents: [document("doc-large", "c", [page(1, CAPABILITY, 1_000)])],
    maximumPagesPerTask: 2,
    maximumBytesPerTask: 100,
  });
  assert.equal(oversize[0].oversizeSinglePage, true, "one large page must remain an explicit schedulable exception");
});

test("weighted fairness preserves a small-job fast lane, tenant hierarchy, and provider admission limits", () => {
  const tasks = [];
  for (let index = 0; index < 12; index += 1) tasks.push(scheduledTask(`large-${index}`, "tenant-large", "matter-a", "intake-large", CAPABILITY));
  for (let index = 0; index < 2; index += 1) tasks.push(scheduledTask(`small-${index}`, "tenant-small", "matter-b", "intake-small", CAPABILITY));
  for (let index = 0; index < 4; index += 1) tasks.push(scheduledTask(`sibling-${index}`, "tenant-large", "matter-c", "intake-sibling", REPAIR));
  const schedule = scheduleWeightedFair(tasks, { smallJobThreshold: 3, smallJobBoost: 1.5 });
  assert.ok(schedule.slice(0, 3).some((task) => task.tenantId === "tenant-small"));
  assert.deepEqual(schedule.filter((task) => task.intakeId === "intake-large").map((task) => task.taskId), Array.from({ length: 12 }, (_, index) => `large-${index}`));
  assert.ok(schedule.findIndex((task) => task.intakeId === "intake-sibling") < 6, "a sibling matter must not wait behind the large intake");
  assert.ok(schedule.find((task) => task.tenantId === "tenant-small").scheduling.smallJobBoostApplied > 1);

  const capabilityKey = `${CAPABILITY.provider}\u0000${CAPABILITY.model}\u0000${CAPABILITY.adapterVersion}`;
  const admitted = admitScheduledTasks(schedule, {
    capacityByCapability: { [capabilityKey]: 3, gemini: 2 },
    maximumTasks: 5,
  });
  assert.equal(admitted.admitted.filter((task) => task.capability.provider === "mistral").length, 3);
  assert.equal(admitted.admitted.filter((task) => task.capability.provider === "gemini").length, 2);
  assert.ok(admitted.deferred.some((task) => task.admissionReason === "provider_capacity_exhausted"));
});

function document(documentId, hashCharacter, pages) {
  return {
    tenantId: `tenant-${documentId}`,
    matterId: `matter-${documentId}`,
    intakeId: `intake-${documentId}`,
    documentId,
    sourceSha256: hashCharacter.repeat(64),
    pages,
  };
}

function page(pageNumber, capability, bytes, { status = "queued", weight = 1 } = {}) {
  return {
    pageNumber,
    workUnitId: `work-${pageNumber}-${capability.provider}`,
    fingerprint: (capability.provider === "mistral" ? "d" : "e").repeat(63) + String(pageNumber % 10),
    bytes,
    weight,
    status,
    capability,
  };
}

function scheduledTask(taskId, tenantId, matterId, intakeId, capability) {
  return {
    taskId,
    tenantId,
    matterId,
    intakeId,
    weight: 1,
    priority: 0,
    createdAt: "2026-08-24T12:00:00.000Z",
    capability,
  };
}

