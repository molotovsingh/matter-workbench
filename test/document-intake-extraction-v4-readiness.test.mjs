import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateV4Acceptance, renderV4AcceptanceEvaluation } from "../services/document-intake-extraction/readiness/evaluate-acceptance.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("V4 readiness fails closed while certification and cutover evidence remain pending", async () => {
  const evaluation = await evaluateV4Acceptance({
    matrixPath: path.join(ROOT, "docs/acceptance/document-intake-extraction-v4.matrix.json"),
    repositoryRoot: ROOT,
  });
  assert.equal(evaluation.productionReady, false);
  assert.equal(evaluation.cutoverAllowed, false);
  assert.equal(evaluation.evidenceProblems.length, 0);
  assert.ok(evaluation.totals.implementedEvidenceGates >= 18);
  assert.deepEqual(evaluation.blockers.map((blocker) => blocker.gateId), [
    "V4-LOAD-001", "V4-QUALITY-001", "V4-QUOTA-001", "V4-SECURITY-001", "V4-CUTOVER-001",
  ]);
  const rendered = renderV4AcceptanceEvaluation(evaluation);
  assert.match(rendered, /production ready: NO/);
  assert.match(rendered, /V4-QUALITY-001/);
});

test("V4 readiness treats missing automated evidence as a blocker", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mwb-v4-readiness-"));
  try {
    await mkdir(path.join(root, "docs"));
    const matrixPath = path.join(root, "docs", "matrix.json");
    await writeFile(matrixPath, JSON.stringify({
      schemaVersion: "document-intake-extraction.acceptance-matrix/v1",
      evidenceCommands: {},
      gates: [{ id: "V4-TEST-001", category: "test", status: "automated", requirement: "evidence exists", evidence: ["test/missing.test.mjs"] }],
    }));
    const evaluation = await evaluateV4Acceptance({ matrixPath, repositoryRoot: root });
    assert.equal(evaluation.productionReady, false);
    assert.deepEqual(evaluation.evidenceProblems, [{ gateId: "V4-TEST-001", evidence: "test/missing.test.mjs", problem: "missing" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
