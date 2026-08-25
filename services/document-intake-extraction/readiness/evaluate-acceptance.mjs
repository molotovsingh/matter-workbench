import { access, readFile } from "node:fs/promises";
import path from "node:path";

export async function evaluateV4Acceptance({ matrixPath, repositoryRoot = process.cwd() } = {}) {
  if (!matrixPath) throw new Error("V4 acceptance matrix path is required");
  const matrix = JSON.parse(await readFile(matrixPath, "utf8"));
  if (matrix.schemaVersion !== "document-intake-extraction.acceptance-matrix/v1") throw new Error("unsupported V4 acceptance matrix");
  const evidenceProblems = [];
  for (const gate of matrix.gates) {
    if (gate.status !== "automated") continue;
    for (const evidence of gate.evidence || []) {
      const target = path.resolve(repositoryRoot, evidence);
      if (!target.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`)) {
        evidenceProblems.push({ gateId: gate.id, evidence, problem: "path_escape" });
        continue;
      }
      try {
        await access(target);
      } catch {
        evidenceProblems.push({ gateId: gate.id, evidence, problem: "missing" });
      }
    }
  }
  const implemented = matrix.gates.filter((gate) => gate.status === "automated");
  const blockers = matrix.gates.filter((gate) => gate.status !== "automated").map((gate) => ({
    gateId: gate.id,
    category: gate.category,
    requirement: gate.requirement,
    owner: gate.owner,
    blocker: gate.blocker,
  }));
  return {
    schemaVersion: "document-intake-extraction.acceptance-evaluation/v1",
    evaluatedAt: new Date().toISOString(),
    productionReady: blockers.length === 0 && evidenceProblems.length === 0,
    cutoverAllowed: blockers.length === 0 && evidenceProblems.length === 0,
    totals: {
      gates: matrix.gates.length,
      implementedEvidenceGates: implemented.length,
      pendingEvidenceGates: blockers.length,
      evidenceProblems: evidenceProblems.length,
    },
    implementedGateIds: implemented.map((gate) => gate.id),
    blockers,
    evidenceProblems,
    evidenceCommands: matrix.evidenceCommands,
  };
}

export function renderV4AcceptanceEvaluation(evaluation) {
  const lines = [
    `V4 production ready: ${evaluation.productionReady ? "YES" : "NO"}`,
    `Implemented evidence gates: ${evaluation.totals.implementedEvidenceGates}/${evaluation.totals.gates}`,
    `Pending certification gates: ${evaluation.totals.pendingEvidenceGates}`,
  ];
  if (evaluation.evidenceProblems.length) {
    lines.push("", "Evidence problems:");
    for (const problem of evaluation.evidenceProblems) lines.push(`- ${problem.gateId}: ${problem.evidence} (${problem.problem})`);
  }
  if (evaluation.blockers.length) {
    lines.push("", "Cutover blockers:");
    for (const blocker of evaluation.blockers) lines.push(`- ${blocker.gateId}: ${blocker.blocker}`);
  }
  return lines.join("\n");
}
