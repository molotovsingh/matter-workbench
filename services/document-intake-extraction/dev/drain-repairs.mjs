#!/usr/bin/env node
// Drain queued repair-capability page computations for one isolated tenant.
//
// Companion to isolated-run.mjs for the case where a run's polling window
// closed while repair work was still queued: the state is durable, so this
// tool runs one worker per repair rung until the ladder's queues are empty,
// letting the original intake publish.
//
//   node services/document-intake-extraction/dev/drain-repairs.mjs --tenant <tenant> [--repair-lanes 8]

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import pg from "pg";

import { S3CompatibleObjectStore } from "../adapters/s3-compatible-object-store.mjs";
import { createPageValidator } from "../page-validator.mjs";
import { createSelectiveRepairRouter } from "../routing/selective-repair-router.mjs";
import { PostgresResultRepository } from "../postgres/postgres-result-repository.mjs";
import { PostgresUploadAuthorizationStore } from "../postgres/postgres-upload-authorization-store.mjs";
import { PostgresWorkRepository } from "../postgres/postgres-work-repository.mjs";
import { buildProviderSuite, createLocalDiskS3 } from "../integration/local-composition.mjs";
import { BoundedDocumentWorkerLoop } from "../../../workers/document-processing/bounded-worker-loop.mjs";
import { PdfPageMaterializer } from "../../../workers/document-processing/pdf-page-materializer.mjs";
import { PostgresDocumentProcessingWorker } from "../../../workers/document-processing/postgres-document-processing-worker.mjs";
import { WorkerScratchSpace } from "../../../workers/document-processing/worker-scratch-space.mjs";

const options = { tenantId: "", repairLanes: 8, dbAdminUrl: "postgres://127.0.0.1:5432/postgres", dbName: "mwb_v4_isolated", timeoutMinutes: 30 };
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const next = () => argv[++index];
  if (argv[index] === "--tenant") options.tenantId = next();
  else if (argv[index] === "--repair-lanes") options.repairLanes = Number(next());
  else if (argv[index] === "--db-name") options.dbName = next();
  else if (argv[index] === "--timeout-minutes") options.timeoutMinutes = Number(next());
  else { console.error(`unknown option ${argv[index]}`); process.exit(1); }
}
if (!options.tenantId) { console.error("--tenant is required"); process.exit(1); }

for (const candidate of [path.resolve(".env"), "/Users/aksingh/matter-workbench/.env"]) {
  try {
    for (const line of (await readFile(candidate, "utf8")).split("\n")) {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (match && match[2].trim() && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
    }
    break;
  } catch {}
}
const geminiKey = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
if (!geminiKey) { console.error("GEMINI_API_KEY or GOOGLE_API_KEY is required"); process.exit(1); }

const homeRoot = path.join(os.homedir(), ".mwb-v4-isolated");
const credentials = JSON.parse(await readFile(path.join(homeRoot, "runtime-role.json"), "utf8"));
const url = new URL(options.dbAdminUrl);
url.pathname = `/${options.dbName}`;
url.username = credentials.roleName;
url.password = credentials.password;
const pool = new pg.Pool({ connectionString: url.toString(), max: options.repairLanes + 8 });

const localS3 = createLocalDiskS3({ root: path.join(homeRoot, "object-store") });
const objectStore = new S3CompatibleObjectStore({
  bucket: "mwb-v4-isolated",
  region: "local-disk",
  authorizationStore: new PostgresUploadAuthorizationStore({ pool }),
  presigner: localS3.presigner,
  client: localS3.client,
});

// Drain every rung the fleet can escalate to, not just the first: pages
// queued at a later rung are exactly the ones a closed polling window leaves
// behind, and counting only the first rung would report success while the
// intake stays blocked.
const suite = buildProviderSuite({
  geminiKey,
  mistralKey: process.env.MISTRAL_API_KEY,
  openaiKey: process.env.OPENAI_API_KEY,
  primary: "gemini",
  native: false,
});
const repairRouter = createSelectiveRepairRouter({ repairProviders: suite.repairLadder });
const workRepository = new PostgresWorkRepository({ pool });
const resultRepository = new PostgresResultRepository({ pool });
const pageMaterializer = new PdfPageMaterializer();
const validator = createPageValidator();

function workerForRung(rung, index) {
  return new PostgresDocumentProcessingWorker({
    workRepository,
    resultRepository,
    objectStore,
    scratchSpace: new WorkerScratchSpace({ root: path.join(homeRoot, "scratch", `drain-${index}`) }),
    pageMaterializer,
    providers: [rung],
    validator,
    repairRouter,
  });
}

async function withTenantClient(operation) {
  const client = await pool.connect();
  try {
    await client.query("select set_config('document_intake_extraction.tenant_id', $1, false)", [options.tenantId]);
    return await operation(client);
  } finally {
    client.release();
  }
}

async function pendingCounts() {
  const ladderKeys = suite.repairLadder.map((rung) => [rung.capability.provider, rung.capability.model, rung.capability.adapterVersion].join("|"));
  return withTenantClient(async (client) => {
    const result = await client.query([
      "select",
      "  count(*) filter (where concat_ws('|', provider, model, adapter_version) = any($2::text[]))::int as ladder,",
      "  count(*) filter (where concat_ws('|', provider, model, adapter_version) <> all($2::text[]))::int as other",
      "from document_intake_extraction.page_computations",
      "where tenant_id = $1 and status in ('queued', 'running')",
    ].join("\n"), [options.tenantId, ladderKeys]);
    return { ladder: result.rows[0].ladder, other: result.rows[0].other };
  });
}

const initial = await pendingCounts();
console.log(`draining ${initial.ladder} pending repair page(s) across ${suite.repairLadder.length} rung(s) for ${options.tenantId}`);
if (initial.other) console.log(`  note: ${initial.other} non-repair page(s) are also queued and are not drained by this tool`);
const abort = new AbortController();
let completed = 0;
const runs = suite.repairLadder.map((rung, index) => new BoundedDocumentWorkerLoop({
  worker: workerForRung(rung, index),
  tenantId: options.tenantId,
  workerIdPrefix: `drain-${rung.capability.provider}-${index}`,
  concurrency: index === 0 ? Math.max(1, Math.min(32, options.repairLanes)) : 2,
  idlePollMs: 300,
  onOutcome: async (event) => {
    if (event.type === "completed") {
      completed += 1;
      if (completed % 10 === 0) console.log(`  ${completed} repair page(s) completed`);
    } else if (event.type === "error") console.log(`  [${rung.capability.provider}] worker error ${event.errorCode}; backing off ${event.delayMs}ms`);
  },
}).run({ signal: abort.signal }));

const deadline = Date.now() + options.timeoutMinutes * 60_000;
let quietChecks = 0;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const pending = await pendingCounts();
  if (pending.ladder === 0) {
    quietChecks += 1;
    if (quietChecks >= 2) break;
  } else {
    quietChecks = 0;
  }
}
abort.abort();
await Promise.allSettled(runs);
const remaining = await pendingCounts();
await withTenantClient(async (client) => {
  const rows = await client.query(
    "select intake_id::text, status, result_id::text from document_intake_extraction.intakes where tenant_id = $1 order by created_at",
    [options.tenantId],
  );
  console.log(`drain finished: ${completed} completed this run, ${remaining.ladder} repair page(s) still pending`);
  if (remaining.other) console.log(`  ${remaining.other} non-repair page(s) remain queued — an intake may still be unpublished`);
  for (const row of rows.rows) console.log(`  intake ${row.intake_id}: ${row.status}${row.result_id ? ` (result ${row.result_id})` : ""}`);
});
await pool.end();
process.exit(remaining.ladder === 0 && remaining.other === 0 ? 0 : 2);
