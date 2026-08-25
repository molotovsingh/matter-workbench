import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateSecurityCertification,
  REQUIRED_SECURITY_CONTROLS,
} from "../services/document-intake-extraction/readiness/security-certification.mjs";

// V4-SECURITY-001 tooling evidence only; independent production-shaped review remains pending.
test("security certification requires every reviewed production-shaped control and no open high finding", () => {
  const controls = completeControls();
  const certification = evaluateSecurityCertification({
    controls,
    findings: [{ findingId: "finding-low-1", severity: "low", status: "open" }],
    evaluatedAt: "2026-08-24T12:00:00.000Z",
  });
  assert.equal(certification.certified, true);
  assert.equal(certification.passedControls.length, REQUIRED_SECURITY_CONTROLS.length);
  assert.deepEqual(certification.blockingFindings, []);
});

test("security certification fails on missing, expired, development-only controls or open high findings", () => {
  const controls = completeControls();
  controls.shift();
  controls[0] = { ...controls[0], status: "pending", environment: "development", expiresAt: "2026-08-24T11:00:00.000Z" };
  const certification = evaluateSecurityCertification({
    controls,
    findings: [{ findingId: "finding-high-1", severity: "high", status: "mitigated" }],
    evaluatedAt: "2026-08-24T12:00:00.000Z",
  });
  assert.equal(certification.certified, false);
  assert.ok(certification.reasons.includes("required_controls_missing"));
  assert.ok(certification.reasons.includes("control_not_passed"));
  assert.ok(certification.reasons.includes("control_evidence_expired"));
  assert.ok(certification.reasons.includes("blocking_security_findings_open"));
  assert.throws(() => evaluateSecurityCertification({
    controls: [{ ...completeControls()[0], artifactId: "api_key=do-not-store-this" }],
  }), /looks like secret material/);
});

function completeControls() {
  return REQUIRED_SECURITY_CONTROLS.map((controlId, index) => ({
    controlId,
    status: "passed",
    artifactId: `security-artifact-${index + 1}`,
    reviewerId: `reviewer-${(index % 3) + 1}`,
    environment: "production-shaped",
    reviewedAt: "2026-08-24T10:00:00.000Z",
    expiresAt: "2027-08-24T10:00:00.000Z",
  }));
}
