import assert from "node:assert/strict";
import test from "node:test";

import { buildMothershipReport, filterMothershipReport, renderMothershipReportMarkdown } from "../mothership/report.mjs";

test("mothership report routes live beta signals into action lanes", () => {
  const report = buildMothershipReport({
    sinceDays: 1,
    signals: [
      {
        installation_id: "matter-workbench-do-beta-1",
        signal_id: "signal_extract_missing",
        severity: "error",
        source: "job_status",
        matter_name: "Pipeline Matter",
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
        status: "needs_evidence",
        received_at: "2026-06-12T09:00:00.000Z",
        payload: {
          tryingToDo: "Add deadline calendar",
          happenedInstead: "I want a new calendar page for filing deadlines.",
          operatorTriage: {
            status: "needs_evidence",
            updatedAt: "2026-06-17T15:30:00.000Z",
            actor: "aks operator",
            note: "Need product decision; token=super-secret must stay hidden.",
          },
          operatorTriageHistory: [
            { status: "new", updatedAt: "2026-06-17T15:00:00.000Z" },
            { status: "needs_evidence", updatedAt: "2026-06-17T15:30:00.000Z" },
          ],
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
        matterHealth: [{
          matter: "Example Matter",
          prepareState: "complete",
          nextStepLabel: "Core preparation is current",
          attentionState: "clear",
          blockers: 0,
          warnings: 0,
          checkedAt: "2026-06-13T00:00:00.000Z",
        }],
        counters: { failedJobs: 1 },
      },
    }],
  }, { generatedAt: "2026-06-13T00:00:00.000Z" });

  assert.deepEqual(report.summary.actionLanes, {
    fix_now: 1,
    investigate: 2,
    product_decision: 2,
    watch: 1,
  });
  assert.deepEqual(report.summary.severity, {
    blocker: 0,
    error: 1,
    warning: 3,
    info: 2,
  });

  assert.equal(report.summary.featureRequests, 1);
  assert.equal(report.summary.featureIdeas, 0);
  assert.equal(report.summary.latestHeartbeatAgeMinutes, 0);
  assert.equal(report.summary.silentInstallations, 0);
  assert.equal(report.heartbeats.latestByInstallation[0].installationId, "matter-workbench-do-beta-1");
  assert.equal(report.heartbeats.latestByInstallation[0].journeys[0].currentStage, "extract_documents");
  assert.equal(report.heartbeats.latestByInstallation[0].highestPatienceRisk, "high");
  assert.match(renderMothershipReportMarkdown(report), /last seen 2026-06-13T00:00:00\.000Z/);

  const missingExtraction = report.items.find((item) => item.id === "signal_extract_missing");
  assert.equal(missingExtraction.action_lane, "fix_now");
  assert.match(missingExtraction.recommended_action, /preparation/i);

  const copilotCitation = report.items.find((item) => item.id === "feedback_copilot_citation");
  assert.equal(copilotCitation.severity, "warning");
  assert.equal(copilotCitation.status, "new");
  assert.equal(copilotCitation.action_lane, "investigate");
  assert.equal(copilotCitation.currentness, "needs_live_recheck");
  assert.match(copilotCitation.recommended_action, /current deployment/i);
  assert.doesNotMatch(copilotCitation.recommended_action, /FILE-0008/);

  const copilotCopy = report.items.find((item) => item.id === "feedback_copilot_copy");
  assert.equal(copilotCopy.action_lane, "investigate");
  assert.match(copilotCopy.recommended_action, /Reproduce/);

  const confused = report.items.find((item) => item.id === "feedback_confused");
  assert.equal(confused.action_lane, "product_decision");

  const featureRequest = report.items.find((item) => item.id === "feedback_feature_request");
  assert.equal(featureRequest.category, "feature_request");
  assert.equal(featureRequest.severity, "info");
  assert.equal(featureRequest.status, "needs_evidence");
  assert.equal(featureRequest.triageStatusUpdatedAt, "2026-06-17T15:30:00.000Z");
  assert.equal(featureRequest.triageStatusActor, "aks operator");
  assert.equal(featureRequest.triageStatusNote, "Need product decision; token=[redacted-secret] must stay hidden.");
  assert.equal(featureRequest.triageStatusHistoryCount, 2);
  assert.equal(featureRequest.action_lane, "product_decision");
  assert.match(featureRequest.recommended_action, /feature/i);
  assert.doesNotMatch(featureRequest.recommended_action, /bug/i);
  const markdown = renderMothershipReportMarkdown(report);
  assert.match(markdown, /Status updated: 2026-06-17T15:30:00\.000Z by aks operator/);
  assert.match(markdown, /Status note: Need product decision; token=\[redacted-secret\] must stay hidden\./);
  assert.match(markdown, /Status history entries: 2/);
  assert.doesNotMatch(markdown, /super-secret/);

  const warning = report.items.find((item) => item.id === "signal_warning");
  assert.equal(warning.action_lane, "watch");
});

test("mothership report supports bounded filtered operator views", () => {
  const report = buildMothershipReport({
    sinceDays: 1,
    signals: [{
      installation_id: "matter-workbench-do-beta-1",
      signal_id: "signal_fix_now",
      severity: "error",
      source: "job_status",
      matter_name: "Pipeline Matter",
      received_at: "2026-06-12T10:15:00.000Z",
      payload: {
        title: "Label Sources",
        details: { errorMessage: "No extraction records found. Run /extract before creating a source index." },
      },
    }],
    feedback: [
      {
        installation_id: "matter-workbench-do-beta-1",
        feedback_id: "feedback_new_bug",
        classification: "bug",
        status: "new",
        received_at: "2026-06-12T10:00:00.000Z",
        payload: { tryingToDo: "Run a skill", happenedInstead: "It failed." },
      },
      {
        installation_id: "matter-workbench-do-beta-1",
        feedback_id: "feedback_parked_feature",
        classification: "feature_request",
        status: "parked",
        received_at: "2026-06-12T09:00:00.000Z",
        payload: { tryingToDo: "Add a dashboard", happenedInstead: "I want a dashboard." },
      },
    ],
  }, { generatedAt: "2026-06-12T10:20:00.000Z" });

  const fixNow = filterMothershipReport(report, { actionLane: "fix_now", severity: "error", limit: "1" });
  assert.equal(fixNow.view.schema_version, "mothership-report-view/v1");
  assert.deepEqual(fixNow.view.filters, { action_lane: "fix_now", severity: "error", limit: 1 });
  assert.equal(fixNow.view.totalBeforeFilter, 3);
  assert.equal(fixNow.view.totalAfterFilter, 1);
  assert.deepEqual(fixNow.items.map((item) => item.id), ["signal_fix_now"]);
  assert.match(renderMothershipReportMarkdown(fixNow), /Items shown: 1\/3/);
  assert.match(renderMothershipReportMarkdown(fixNow), /Filters: action_lane=fix_now, severity=error, limit=1/);

  const parked = filterMothershipReport(report, { status: "parked" });
  assert.deepEqual(parked.items.map((item) => item.id), ["feedback_parked_feature"]);

  assert.throws(
    () => filterMothershipReport(report, { actionLane: "product_backlog" }),
    /action-lane must be one of/i,
  );
  assert.throws(
    () => filterMothershipReport(report, { limit: "nope" }),
    /limit must be a positive integer/i,
  );
});

test("mothership report downgrades stale preparation failures when latest matter health is clear", () => {
  const report = buildMothershipReport({
    sinceDays: 1,
    signals: [{
      installation_id: "matter-workbench-do-beta-1",
      signal_id: "signal_taori_extract_missing",
      severity: "error",
      source: "job_status",
      matter_name: "Taori vs Roma Builder",
      occurrence_count: 7,
      received_at: "2026-06-12T10:00:00.000Z",
      payload: {
        title: "Label Sources",
        details: { errorMessage: "No extraction records found. Run /extract before creating a source index." },
      },
    }],
    heartbeats: [{
      installation_id: "matter-workbench-do-beta-1",
      heartbeat_id: "heartbeat_taori_clear",
      captured_at: "2026-06-13T10:00:00.000Z",
      received_at: "2026-06-13T10:00:00.000Z",
      payload: {
        id: "heartbeat_taori_clear",
        activeSessions: 0,
        matterHealth: [{
          matter: "Taori vs Roma Builder",
          prepareState: "complete",
          nextStepLabel: "Core preparation is current",
          attentionState: "clear",
          blockers: 0,
          warnings: 0,
          checkedAt: "2026-06-13T09:59:00.000Z",
        }],
      },
    }],
  }, { generatedAt: "2026-06-13T10:01:00.000Z" });

  assert.equal(report.summary.actionLanes.fix_now, 0);
  assert.equal(report.summary.actionLanes.watch, 1);
  const item = report.items.find((entry) => entry.id === "signal_taori_extract_missing");
  assert.equal(item.currentness, "resolved_by_latest_matter_state");
  assert.equal(item.action_lane, "watch");
  assert.match(item.recommended_action, /No code action/);
  assert.equal(item.currentMatterState.prepareState, "complete");
});

test("mothership report links nearby same-matter signals to feedback triage", () => {
  const report = buildMothershipReport({
    sinceDays: 1,
    signals: [
      {
        installation_id: "matter-workbench-do-beta-1",
        signal_id: "signal_nearby_source_labels_failed",
        severity: "error",
        source: "job_status",
        matter_name: "Pipeline Matter",
        received_at: "2026-06-12T10:15:00.000Z",
        payload: {
          title: "Label Sources",
          details: { errorMessage: "No extraction records found. Run /extract before creating a source index." },
        },
      },
      {
        installation_id: "matter-workbench-do-beta-2",
        signal_id: "signal_other_installation",
        severity: "error",
        source: "job_status",
        matter_name: "Pipeline Matter",
        received_at: "2026-06-12T10:10:00.000Z",
        payload: {
          title: "Label Sources",
          details: { errorMessage: "No extraction records found. Run /extract before creating a source index." },
        },
      },
      {
        installation_id: "matter-workbench-do-beta-1",
        signal_id: "signal_too_old",
        severity: "error",
        source: "job_status",
        matter_name: "Pipeline Matter",
        received_at: "2026-06-12T07:00:00.000Z",
        payload: {
          title: "Label Sources",
          details: { errorMessage: "No extraction records found. Run /extract before creating a source index." },
        },
      },
    ],
    feedback: [{
      installation_id: "matter-workbench-do-beta-1",
      feedback_id: "feedback_cannot_find_lod",
      classification: "confusing_ux",
      received_at: "2026-06-12T10:00:00.000Z",
      payload: {
        tryingToDo: "Find List of Dates",
        happenedInstead: "I cannot find where the List of Dates went.",
        context: { activeMatterName: "Pipeline Matter" },
      },
    }],
  }, { generatedAt: "2026-06-12T10:20:00.000Z" });

  const feedback = report.items.find((item) => item.id === "feedback_cannot_find_lod");
  assert.equal(feedback.action_lane, "fix_now");
  assert.equal(feedback.relatedSignals.length, 1);
  assert.equal(feedback.relatedSignals[0].id, "signal_nearby_source_labels_failed");
  assert.match(feedback.reason, /extraction\/source-label\/List of Dates/i);
  assert.match(renderMothershipReportMarkdown(report), /Related signals: 1/);
});

test("mothership report does not let stale matter health clear newer related signal evidence", () => {
  const report = buildMothershipReport({
    sinceDays: 1,
    signals: [{
      installation_id: "matter-workbench-do-beta-1",
      signal_id: "signal_newer_source_labels_failed",
      severity: "error",
      source: "job_status",
      matter_name: "Taori vs Roma Builder",
      received_at: "2026-06-13T10:45:00.000Z",
      payload: {
        title: "Label Sources",
        details: { errorMessage: "No extraction records found. Run /extract before creating a source index." },
      },
    }],
    feedback: [{
      installation_id: "matter-workbench-do-beta-1",
      feedback_id: "feedback_after_clear_health",
      classification: "confusing_ux",
      received_at: "2026-06-13T10:00:00.000Z",
      payload: {
        tryingToDo: "Use List of Dates",
        happenedInstead: "Preparation says it already ran but List of Dates was not generated.",
        context: { activeMatterName: "Taori vs Roma Builder" },
      },
    }],
    heartbeats: [{
      installation_id: "matter-workbench-do-beta-1",
      heartbeat_id: "heartbeat_taori_clear_then_stale",
      captured_at: "2026-06-13T10:30:00.000Z",
      received_at: "2026-06-13T10:30:00.000Z",
      payload: {
        id: "heartbeat_taori_clear_then_stale",
        activeSessions: 0,
        matterHealth: [{
          matter: "Taori vs Roma Builder",
          prepareState: "complete",
          nextStepLabel: "Core preparation is current",
          attentionState: "clear",
          blockers: 0,
          warnings: 0,
          checkedAt: "2026-06-13T10:30:00.000Z",
        }],
      },
    }],
  }, { generatedAt: "2026-06-13T10:50:00.000Z" });

  const feedback = report.items.find((item) => item.id === "feedback_after_clear_health");
  assert.equal(feedback.currentness, "current");
  assert.equal(feedback.action_lane, "fix_now");
  assert.equal(feedback.relatedSignals[0].id, "signal_newer_source_labels_failed");

  const signal = report.items.find((item) => item.id === "signal_newer_source_labels_failed");
  assert.equal(signal.currentness, "current");
  assert.equal(signal.action_lane, "fix_now");
});

test("mothership report adds a bounded what-happened packet with nearby job state", () => {
  const report = buildMothershipReport({
    sinceDays: 1,
    feedback: [{
      installation_id: "matter-workbench-do-beta-1",
      feedback_id: "feedback_blocked_pipeline",
      classification: "bug",
      received_at: "2026-06-13T10:00:00.000Z",
      payload: {
        tryingToDo: "Create List of Dates",
        happenedInstead: "It was blocked.",
        context: { activeMatterName: "Pipeline Matter" },
      },
    }],
    heartbeats: [{
      installation_id: "matter-workbench-do-beta-1",
      heartbeat_id: "heartbeat_pipeline_failed",
      captured_at: "2026-06-13T10:05:00.000Z",
      received_at: "2026-06-13T10:05:00.000Z",
      payload: {
        id: "heartbeat_pipeline_failed",
        activeSessions: 1,
        journeys: [{
          matter: "Pipeline Matter",
          currentStage: "Label Sources",
          currentStageStatus: "failed",
          jobId: "job_123",
          lastError: "No extraction records found. Run /extract before creating a source index. token=secret-token",
          patienceRisk: "high",
        }],
        matterHealth: [{
          matter: "Pipeline Matter",
          prepareState: "stale",
          nextStepLabel: "Extract Documents",
          attentionState: "warning",
          blockers: 0,
          warnings: 1,
          checkedAt: "2026-06-13T10:05:00.000Z",
        }],
      },
    }],
  }, { generatedAt: "2026-06-13T10:06:00.000Z" });

  const feedback = report.items.find((item) => item.id === "feedback_blocked_pipeline");
  assert.equal(feedback.action_lane, "fix_now");
  assert.equal(feedback.relatedJobs.length, 1);
  assert.equal(feedback.relatedJobs[0].jobId, "job_123");
  assert.equal(feedback.relatedJobs[0].detail, "No extraction records found. Run /extract before creating a source index. token=[redacted-secret]");
  assert.equal(feedback.whatHappened.schema_version, "mothership-what-happened/v1");
  assert.equal(feedback.whatHappened.currentMatterState.prepareState, "stale");
  assert.equal(feedback.whatHappened.currentMatterState.nextStepLabel, "Extract Documents");
  assert.equal(feedback.whatHappened.nearbyJobs.length, 1);
  assert.equal(feedback.whatHappened.nearbyJobs[0].status, "failed");
  assert.match(feedback.whatHappened.summary, /1 nearby job/);
  assert.match(feedback.whatHappened.nextAction, /Verify matter preparation state/);

  const markdown = renderMothershipReportMarkdown(report);
  assert.match(markdown, /What happened:/);
  assert.match(markdown, /Current matter state: prepare=stale; attention=warning; next=Extract Documents/);
  assert.match(markdown, /Nearby jobs: Label Sources status=failed/);
  assert.doesNotMatch(markdown, /secret-token/);
});
