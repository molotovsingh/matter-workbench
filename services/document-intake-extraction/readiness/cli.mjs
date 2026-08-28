#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateV4Acceptance, renderV4AcceptanceEvaluation } from "./evaluate-acceptance.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const matrixPath = path.join(repositoryRoot, "docs/acceptance/document-intake-extraction-v4.matrix.json");
const json = process.argv.includes("--json");
const evaluation = await evaluateV4Acceptance({ matrixPath, repositoryRoot });
console.log(json ? JSON.stringify(evaluation, null, 2) : renderV4AcceptanceEvaluation(evaluation));
process.exitCode = evaluation.productionReady ? 0 : 2;
