import assert from "node:assert/strict";
import test from "node:test";
import {
  FEEDBACK_TRIAGE_POLICY_VERSION,
  buildFeedbackTriagePacket,
  routePrivateBetaFeedbackTriage,
} from "../services/private-beta-feedback-triage-service.mjs";

test("feedback triage keeps unsupported-citation bugs deterministic even when classifier disagrees", () => {
  const triage = routePrivateBetaFeedbackTriage({
    category: "bug",
    title: "Ask Copilot",
    detail: "Matter copilot returned unsupported citation: FILE-0008 p1.b2",
    currentness: "current",
  }, {
    classifierResult: {
      classification: "confusing_ux",
      action_lane: "product_decision",
      confidence: "high",
      reason: "The tester may be confused.",
    },
  });

  assert.equal(triage.policyVersion, FEEDBACK_TRIAGE_POLICY_VERSION);
  assert.equal(triage.triage_source, "deterministic");
  assert.equal(triage.action_lane, "fix_now");
  assert.match(triage.recommended_action, /Copilot fail-closed/i);
});

test("feedback triage lets high-confidence classifier clarify a misfiled feature request", () => {
  const triage = routePrivateBetaFeedbackTriage({
    category: "bug",
    title: "Deadline calendar",
    detail: "A week view for filing dates would help.",
  }, {
    classifierResult: {
      classification: "feature_request",
      action_lane: "product_decision",
      confidence: "high",
      reason: "The tester is asking for a capability that does not currently exist.",
      recommended_action: "Decide whether deadline calendar belongs in beta scope.",
      missing_evidence: [],
    },
  });

  assert.equal(triage.triage_source, "classifier");
  assert.equal(triage.classification, "feature_request");
  assert.equal(triage.action_lane, "product_decision");
  assert.doesNotMatch(triage.recommended_action, /bug/i);
});

test("feedback triage sends stale critical signals to live recheck", () => {
  const triage = routePrivateBetaFeedbackTriage({
    category: "critical_signal",
    title: "Runtime API failed",
    detail: "Unhandled server error while loading the workspace.",
    currentness: "needs_live_recheck",
  });

  assert.equal(triage.triage_source, "deterministic");
  assert.equal(triage.classification, "critical_signal");
  assert.equal(triage.action_lane, "investigate");
  assert.match(triage.reason, /newer runtime evidence/i);
  assert.match(triage.recommended_action, /Recheck current runtime evidence/i);
  assert.match(triage.missing_evidence.join(" "), /current signal recurrence/i);
});

test("feedback triage treats cannot-find chronology feedback as UX unless hard evidence exists", () => {
  const ux = routePrivateBetaFeedbackTriage({
    category: "confusing_ux",
    title: "Find output",
    detail: "I cannot find where the List of Dates went.",
  });

  assert.equal(ux.action_lane, "product_decision");
  assert.match(ux.reason, /existing output/i);

  const hard = routePrivateBetaFeedbackTriage({
    category: "confusing_ux",
    title: "Find output",
    detail: "I cannot find where the List of Dates went.",
    relatedSignals: [{ title: "List of Dates", detail: "create_listofdates failed with no Source Index." }],
  });

  assert.equal(hard.action_lane, "fix_now");
  assert.match(hard.recommended_action, /extraction-to-source-labels/i);
});

test("feedback triage escalates vague feedback when related source-label jobs failed", () => {
  const triage = routePrivateBetaFeedbackTriage({
    category: "confusing_ux",
    title: "Understand case",
    detail: "It says preparation is not ready but I already ran it.",
    relatedJobs: [{ kind: "source_labels", status: "failed", detail: "Label Sources failed." }],
  });

  assert.equal(triage.action_lane, "fix_now");
  assert.equal(triage.confidence, "high");
});

test("feedback triage ignores malformed or unsupported classifier output", () => {
  const triage = routePrivateBetaFeedbackTriage({
    category: "operator_note",
    title: "Maybe backlog",
    detail: "Add a product backlog item.",
  }, {
    classifierResult: {
      classification: "feature_request",
      action_lane: "product_backlog",
      confidence: "high",
      reason: "Send to backlog.",
    },
  });

  assert.equal(triage.action_lane, "investigate");
  assert.notEqual(triage.action_lane, "product_backlog");
  assert.match(triage.reason, /unsupported action lane/i);
});

test("feedback triage falls back to investigate for low-confidence classifier output", () => {
  const triage = routePrivateBetaFeedbackTriage({
    category: "operator_note",
    title: "Ambiguous",
    detail: "Something felt off.",
  }, {
    classifierResult: {
      classification: "bug",
      action_lane: "fix_now",
      confidence: "low",
      reason: "Maybe a bug.",
    },
  });

  assert.equal(triage.action_lane, "investigate");
  assert.equal(triage.confidence, "low");
  assert.match(triage.recommended_action, /Investigate manually/i);
});

test("feedback triage routes product requests filed as bugs to product decision", () => {
  const triage = routePrivateBetaFeedbackTriage({
    category: "bug",
    title: "An box to be created",
    detail: "An box to be created to make changes in list of dates or ask to explain or edit or skip.",
  });

  assert.equal(triage.triage_source, "deterministic");
  assert.equal(triage.classification, "feature_request");
  assert.equal(triage.action_lane, "product_decision");
  assert.match(triage.reason, /product or workflow request/i);
  assert.deepEqual(triage.missing_evidence, []);
});

test("feedback triage keeps concrete product-control failures as bugs", () => {
  const triage = routePrivateBetaFeedbackTriage({
    category: "bug",
    title: "Use Copilot copy button",
    detail: "The Copilot answer copy button did not respond.",
  });

  assert.equal(triage.classification, "bug");
  assert.equal(triage.action_lane, "investigate");
  assert.match(triage.missing_evidence.join(" "), /current deployment reproduction/i);
});

test("feedback triage routes onboarding complaints filed as bugs to UX review", () => {
  const triage = routePrivateBetaFeedbackTriage({
    category: "bug",
    title: "Learn how it works doesn't help at all",
    detail: "Learn how it works doesn't help at all.",
  });

  assert.equal(triage.classification, "confusing_ux");
  assert.equal(triage.action_lane, "product_decision");
  assert.match(triage.recommended_action, /onboarding\/help copy/i);
});

test("feedback triage routes successful-but-slow reports filed as bugs to watch", () => {
  const triage = routePrivateBetaFeedbackTriage({
    category: "bug",
    title: "IT was successful, though it took time",
    detail: "IT was successful, though it took time",
  });

  assert.equal(triage.classification, "operator_note");
  assert.equal(triage.action_lane, "watch");
  assert.match(triage.reason, /successful operation/i);
  assert.deepEqual(triage.missing_evidence, []);
});

test("feedback triage keeps unresolved slow reports in the evidence queue", () => {
  const triage = routePrivateBetaFeedbackTriage({
    category: "bug",
    title: "Taking lot of time",
    detail: "Taking lot of time",
  });

  assert.equal(triage.classification, "bug");
  assert.equal(triage.action_lane, "investigate");
  assert.match(triage.missing_evidence.join(" "), /current deployment reproduction/i);
});

test("feedback triage routes positive and smoke notes filed as bugs to watch", () => {
  const positive = routePrivateBetaFeedbackTriage({
    category: "bug",
    title: "The app is helpful",
    detail: "The app is helpful.",
  });
  const smoke = routePrivateBetaFeedbackTriage({
    category: "bug",
    title: "Codex feedback smoke 1781360442119: save form should close.",
    detail: "Codex feedback smoke 1781360442119: save form should close.",
  });

  assert.equal(positive.classification, "operator_note");
  assert.equal(positive.action_lane, "watch");
  assert.equal(smoke.classification, "operator_note");
  assert.equal(smoke.action_lane, "watch");
});

test("feedback triage keeps legal-quality bugs ahead of product-request heuristics", () => {
  const triage = routePrivateBetaFeedbackTriage({
    category: "bug",
    title: "In judgement case details are missing",
    detail: "In judgement case details are missing; add more case details.",
  });

  assert.equal(triage.classification, "legal_quality_concern");
  assert.equal(triage.action_lane, "investigate");
});

test("feedback triage packet is bounded and redacts secrets before any classifier", () => {
  const packet = buildFeedbackTriagePacket({
    id: "feedback_secret",
    category: "bug",
    title: "Provider failed",
    detail: "The key sk-secret-feedback leaked in the error.",
    relatedSignals: [{ title: "Signal", detail: "Bearer sk-other-secret appeared." }],
  });
  const text = JSON.stringify(packet);

  assert.equal(packet.schema_version, "private-beta-feedback-triage-packet/v1");
  assert.doesNotMatch(text, /sk-secret-feedback|sk-other-secret/);
  assert.match(text, /\[redacted-secret\]/);
  assert.deepEqual(packet.allowed.actionLanes, ["fix_now", "investigate", "product_decision", "watch"]);
});
