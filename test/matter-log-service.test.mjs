import assert from "node:assert/strict";
import test from "node:test";

import { createMatterLogService, jobsToMatterLogEntries, runsToMatterLogEntries } from "../services/matter-log-service.mjs";

test("matter log service projects jobs and custom skill runs as non-canonical read-only entries", async () => {
  const service = createMatterLogService({
    now: () => new Date("2026-06-26T12:00:00.000Z"),
    jobStatusService: {
      listJobs: async (filters) => ({
        schema_version: "job-status-ledger/v1",
        jobs: [{
          schema_version: "job-status/v1",
          id: "job_extract",
          kind: "extract",
          label: "Extract Documents",
          status: "succeeded",
          matterName: filters.matterName,
          startedAt: "2026-06-26T09:00:00.000Z",
          finishedAt: "2026-06-26T09:05:00.000Z",
          summary: "Extracted 1 source.",
          metadata: { workflow: { route: "/api/extract", stage: "extract" } },
        }],
      }),
    },
    configurableSkillRunsService: {
      listRuns: async () => ({
        schema_version: "configurable-skill-runs/v1",
        runs: [{
          schema_version: "configurable-skill-run-ledger/v1",
          id: "run_story",
          skillId: "skill_story",
          slash: "/the_story",
          title: "The Story",
          status: "succeeded",
          matterName: "Taori vs Roma Builder",
          matterFolder: "Taori vs Roma Builder",
          startedAt: "2026-06-26T10:00:00.000Z",
          finishedAt: "2026-06-26T10:02:00.000Z",
          outputPaths: { markdown: "20_Workshop/The Story.md" },
          outputAvailability: { markdown: "present" },
          overwrite: "not_needed",
          receipt: { receiptState: "completed" },
        }],
      }),
    },
  });

  const log = await service.readMatterLog({ matterName: "Taori vs Roma Builder", limit: 10 });

  assert.equal(log.schema_version, "matter-log/v0-readonly");
  assert.equal(log.status, "best_effort_projection");
  assert.equal(log.generatedAt, "2026-06-26T12:00:00.000Z");
  assert.equal(log.summary.canonicalEvents, false);
  assert.deepEqual(log.summary.sourceLedgers, ["configurable_skill_runs", "job_status"]);
  assert.equal(log.entries.length, 2);
  assert.deepEqual(log.entries.map((entry) => entry.id), ["custom_skill_run:run_story", "job:job_extract"]);
  assert.ok(log.entries.every((entry) => entry.custodyGrade === "projection"));
  assert.ok(log.entries.every((entry) => entry.canonical === false));
  assert.match(log.limitations.join("\n"), /until canonical matter_events are recorded/i);
  assert.match(log.limitations.join("\n"), /Conversation memory.*not treated as evidence/i);

  const runEntry = log.entries[0];
  assert.equal(runEntry.eventType, "custom_skill.run.succeeded");
  assert.equal(runEntry.category, "generated_artifact");
  assert.equal(runEntry.details.outputPaths.markdown, "20_Workshop/The Story.md");

  const jobEntry = log.entries[1];
  assert.equal(jobEntry.eventType, "job.extract.succeeded");
  assert.equal(jobEntry.category, "source_preparation");
  assert.equal(jobEntry.route, "/api/extract");
});

test("matter log service includes canonical matter_events before legacy projections", async () => {
  const service = createMatterLogService({
    now: () => new Date("2026-06-26T12:30:00.000Z"),
    matterEventsService: {
      listEvents: async () => ({
        schema_version: "matter-events/v1",
        events: [{
          schema_version: "matter-event/v1",
          eventId: "11111111-1111-4111-8111-111111111111",
          eventType: "custom_skill.created",
          occurredAt: "2026-06-26T12:10:00.000Z",
          matterName: "Taori vs Roma Builder",
          summaryKey: "custom_skill_created",
          object: { type: "custom_skill", id: "skill_issue", label: "Issue Discovery" },
          payload: { slash: "/issue_discovery", title: "Issue Discovery" },
          idempotencyKey: "custom_skill.created:skill_issue:v1",
        }],
      }),
    },
    jobStatusService: {
      listJobs: async () => ({ jobs: [{ id: "job_extract", kind: "extract", label: "Extract", status: "succeeded", matterName: "Taori vs Roma Builder", startedAt: "2026-06-26T12:00:00.000Z" }] }),
    },
    configurableSkillRunsService: { listRuns: async () => ({ runs: [] }) },
  });

  const log = await service.readMatterLog({ matterName: "Taori vs Roma Builder", limit: 10 });

  assert.equal(log.summary.canonicalEvents, true);
  assert.deepEqual(log.summary.sourceLedgers, ["job_status", "matter_events"]);
  assert.equal(log.entries[0].id, "event:11111111-1111-4111-8111-111111111111");
  assert.equal(log.entries[0].sourceLedger, "matter_events");
  assert.equal(log.entries[0].canonical, true);
  assert.equal(log.entries[0].custodyGrade, "canonical_event");
  assert.equal(log.entries[0].category, "skill_factory");
  assert.equal(log.entries[0].summary, "Issue Discovery custom skill was created (/issue_discovery).");
  assert.match(log.limitations.join("\n"), /Canonical matter_events are included when present/);
});


test("matter log projection filters to the requested matter without treating receipts as evidence", () => {
  const jobEntries = jobsToMatterLogEntries([
    { id: "job_a", kind: "intake", label: "Set Up Matter", status: "succeeded", matterName: "Matter A", startedAt: "2026-06-26T08:00:00.000Z" },
    { id: "job_b", kind: "intake", label: "Set Up Matter", status: "succeeded", matterName: "Matter B", startedAt: "2026-06-26T08:01:00.000Z" },
  ], { matterName: "Matter B" });
  const runEntries = runsToMatterLogEntries([
    { id: "run_a", status: "succeeded", matterFolder: "Matter A", startedAt: "2026-06-26T08:02:00.000Z" },
    { id: "run_b", status: "failed", matterFolder: "Matter B", startedAt: "2026-06-26T08:03:00.000Z", errorMessage: "Provider unavailable" },
  ], { matterName: "Matter B" });

  assert.deepEqual(jobEntries.map((entry) => entry.sourceId), ["job_b"]);
  assert.deepEqual(runEntries.map((entry) => entry.sourceId), ["run_b"]);
  assert.equal(runEntries[0].status, "failed");
  assert.match(runEntries[0].summary, /Provider unavailable/);
  assert.doesNotMatch(JSON.stringify([...jobEntries, ...runEntries]), /copilot|conversation/i);
});
