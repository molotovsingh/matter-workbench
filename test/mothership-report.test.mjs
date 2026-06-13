import assert from "node:assert/strict";
import test from "node:test";

import { buildMothershipReport } from "../mothership/report.mjs";

test("mothership report routes live beta signals into action lanes", () => {
  const report = buildMothershipReport({
    sinceDays: 1,
    signals: [
      {
        installation_id: "matter-workbench-do-beta-1",
        signal_id: "signal_extract_missing",
        severity: "error",
        source: "job_status",
        matter_name: "Example Matter",
        occurrence_count: 1,
        received_at: "2026-06-12T12:00:00.000Z",
        payload: {
          title: "Label Sources",
          details: { errorMessage: "No extraction records found. Run /extract before creating a source index." },
        },
      },
      {
        installation_id: "matter-workbench-do-beta-1",
        signal_id: "signal_warning",
        severity: "warning",
        source: "job_status",
        occurrence_count: 1,
        received_at: "2026-06-12T11:00:00.000Z",
        payload: { title: "Slow step", details: { message: "One OCR step was slow." } },
      },
    ],
    feedback: [
      {
        installation_id: "matter-workbench-do-beta-1",
        feedback_id: "feedback_copilot_citation",
        classification: "bug",
        received_at: "2026-06-12T10:00:00.000Z",
        payload: {
          tryingToDo: "Ask Copilot",
          happenedInstead: "failed: Matter copilot returned unsupported citation: FILE-0008 p1.b2",
          context: { activeMatterName: "Example Matter" },
        },
      },
      {
        installation_id: "matter-workbench-do-beta-1",
        feedback_id: "feedback_copilot_copy",
        classification: "bug",
        received_at: "2026-06-12T09:30:00.000Z",
        payload: {
          tryingToDo: "Use Copilot copy button",
          happenedInstead: "The Copilot answer copy button did not respond.",
          context: { activeMatterName: "Example Matter" },
        },
      },
      {
        installation_id: "matter-workbench-do-beta-1",
        feedback_id: "feedback_feature_request",
        classification: "feature_request",
        received_at: "2026-06-12T09:00:00.000Z",
        payload: {
          tryingToDo: "Add deadline calendar",
          happenedInstead: "I want a new calendar page for filing deadlines.",
        },
      },
      {
        installation_id: "matter-workbench-do-beta-1",
        feedback_id: "feedback_confused",
        classification: "confusing_ux",
        received_at: "2026-06-12T08:30:00.000Z",
        payload: {
          tryingToDo: "Understand the app",
          happenedInstead: "I did not know whether List of Dates runs automatically.",
        },
      },
    ],
    metrics: [],
    heartbeats: [{
      installation_id: "matter-workbench-do-beta-1",
      heartbeat_id: "heartbeat_001",
      captured_at: "2026-06-13T00:00:00.000Z",
      received_at: "2026-06-13T00:00:00.000Z",
      payload: {
        id: "heartbeat_001",
        activeSessions: 1,
        journeys: [{
          user: "shivangi@lawzeus.com",
          matter: "Gionee",
          currentStage: "extract_documents",
          currentStageStatus: "failed",
          patienceRisk: "high",
        }],
        counters: { failedJobs: 1 },
      },
    }],
  }, { generatedAt: "2026-06-13T00:00:00.000Z" });

  assert.deepEqual(report.summary.actionLanes, {
    fix_now: 2,
    investigate: 1,
    product_decision: 2,
    watch: 1,
  });

  assert.equal(report.summary.featureRequests, 1);
  assert.equal(report.summary.featureIdeas, 0);
  assert.equal(report.summary.latestHeartbeatAgeMinutes, 0);
  assert.equal(report.summary.silentInstallations, 0);
  assert.equal(report.heartbeats.latestByInstallation[0].installationId, "matter-workbench-do-beta-1");
  assert.equal(report.heartbeats.latestByInstallation[0].journeys[0].currentStage, "extract_documents");
  assert.equal(report.heartbeats.latestByInstallation[0].highestPatienceRisk, "high");

  const missingExtraction = report.items.find((item) => item.id === "signal_extract_missing");
  assert.equal(missingExtraction.action_lane, "fix_now");
  assert.match(missingExtraction.recommended_action, /preparation/i);

  const copilotCitation = report.items.find((item) => item.id === "feedback_copilot_citation");
  assert.equal(copilotCitation.action_lane, "fix_now");
  assert.match(copilotCitation.recommended_action, /Copilot/i);
  assert.doesNotMatch(copilotCitation.recommended_action, /FILE-0008/);

  const copilotCopy = report.items.find((item) => item.id === "feedback_copilot_copy");
  assert.equal(copilotCopy.action_lane, "investigate");
  assert.match(copilotCopy.recommended_action, /Reproduce/);

  const confused = report.items.find((item) => item.id === "feedback_confused");
  assert.equal(confused.action_lane, "product_decision");

  const featureRequest = report.items.find((item) => item.id === "feedback_feature_request");
  assert.equal(featureRequest.category, "feature_request");
  assert.equal(featureRequest.action_lane, "product_decision");
  assert.match(featureRequest.recommended_action, /feature/i);
  assert.doesNotMatch(featureRequest.recommended_action, /bug/i);

  const warning = report.items.find((item) => item.id === "signal_warning");
  assert.equal(warning.action_lane, "watch");
});
