#!/usr/bin/env node
// Drain queued repair-capability page computations for one isolated tenant.
//
// Companion to isolated-run.mjs for the case where a run's polling window
// closed while repair work was still queued: the state is durable, so this
// tool runs repair-only worker lanes until the queue is empty, letting the
// original intake publish.
//
//   node services/document-intake-extraction/dev/drain-repairs.mjs --tenant <tenant> [--repair-lanes 8]

import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { copyFile, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { S3CompatibleObjectStore } from "../adapters/s3-compatible-object-store.mjs";
import { createPageValidator } from "../page-validator.mjs";
import { createGemini37RepairPageAdapter } from "../providers/gemini37-repair-adapter.mjs";
import { createSelectiveRepairRouter } from "../routing/selective-repair-router.mjs";
import { PostgresResultRepository } from "../postgres/postgres-result-repository.mjs";
import { PostgresUploadAuthorizationStore } from "../postgres/postgres-upload-authorization-store.mjs";
import { PostgresWorkRepository } from "../postgres/postgres-work-repository.mjs";
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
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.+)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
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
const pool = new pg.Pool({ connectionString: url.toString(), max: options.repairLanes + 4 });

const storeRoot = path.join(homeRoot, "object-store");
const objectPath = (bucket, key) => path.resolve(storeRoot, bucket, key);
const metaPath = (target) => `${target}.s3meta.json`;
const objectStore = new S3CompatibleObjectStore({
  bucket: "mwb-v4-isolated",
  region: "local-disk",
  authorizationStore: new PostgresUploadAuthorizationStore({ pool }),
  presigner: {
    async presignPut({ bucket, key }) {
      const target = objectPath(bucket, key);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      return { url: `file://${target}` };
    },
  },
  client: {
    async headBucket({ bucket }) { await mkdir(path.resolve(storeRoot, bucket), { recursive: true, mode: 0o700 }); return {}; },
    async headObject({ bucket, key }) {
      const target = objectPath(bucket, key);
      const details = await stat(target);
      let meta = {};
      try { meta = JSON.parse(await readFile(metaPath(target), "utf8")); } catch {}
      return { contentLength: details.size, versionId: meta.versionId || "", metadata: meta.metadata || {} };
    },
    async getObject({ bucket, key }) { const target = objectPath(bucket, key); await stat(target); return { body: createReadStream(target) }; },
    async copyObject({ sourceBucket, sourceKey, destinationBucket, destinationKey, metadata }) {
      const source = objectPath(sourceBucket, sourceKey);
      const destination = objectPath(destinationBucket, destinationKey);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      try { await copyFile(source, destination, fsConstants.COPYFILE_EXCL); } catch (error) { if (error?.code !== "EEXIST") throw error; }
      await writeFile(metaPath(destination), `${JSON.stringify({ versionId: randomUUID(), metadata: metadata || {} })}\n`, { mode: 0o600 });
      return {};
    },
    async deleteObject({ bucket, key }) { await rm(objectPath(bucket, key), { force: true }); await rm(metaPath(objectPath(bucket, key)), { force: true }); return {}; },
  },
});

const repairProvider = createGemini37RepairPageAdapter({ apiKey: geminiKey });
const workRepository = new PostgresWorkRepository({ pool });
const worker = new PostgresDocumentProcessingWorker({
  workRepository,
  resultRepository: new PostgresResultRepository({ pool }),
  objectStore,
  scratchSpace: new WorkerScratchSpace({ root: path.join(homeRoot, "scratch", "drain") }),
  pageMaterializer: new PdfPageMaterializer(),
  providers: [repairProvider],
  validator: createPageValidator(),
  repairRouter: createSelectiveRepairRouter({ repairProvider }),
});

async function pendingCount() {
  const client = await pool.connect();
  try {
    await client.query("select set_config('document_intake_extraction.tenant_id', $1, false)", [options.tenantId]);
    const result = await client.query([
      "select count(*)::int as pending from document_intake_extraction.page_computations",
      "where tenant_id = $1 and provider = $2 and model = $3 and adapter_version = $4 and status in ('queued', 'running')",
    ].join("\n"), [options.tenantId, repairProvider.capability.provider, repairProvider.capability.model, repairProvider.capability.adapterVersion]);
    return result.rows[0].pending;
  } finally {
    client.release();
  }
}

const initial = await pendingCount();
console.log(`draining ${initial} pending repair page(s) for ${options.tenantId} with ${options.repairLanes} lane(s)`);
const abort = new AbortController();
let completed = 0;
const loop = new BoundedDocumentWorkerLoop({
  worker,
  tenantId: options.tenantId,
  workerIdPrefix: "drain-repair",
  concurrency: Math.max(1, Math.min(32, options.repairLanes)),
  idlePollMs: 300,
  onOutcome: async (event) => {
    if (event.type === "completed") {
      completed += 1;
      if (completed % 10 === 0) console.log(`  ${completed} repair page(s) completed`);
    } else if (event.type === "error") console.log(`  worker error ${event.errorCode}; backing off ${event.delayMs}ms`);
  },
});
const run = loop.run({ signal: abort.signal });
const deadline = Date.now() + options.timeoutMinutes * 60_000;
let quietChecks = 0;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const pending = await pendingCount();
  if (pending === 0) {
    quietChecks += 1;
    if (quietChecks >= 2) break;
  } else {
    quietChecks = 0;
  }
}
abort.abort();
await run;
const remaining = await pendingCount();
const intakes = await pool.connect();
try {
  await intakes.query("select set_config('document_intake_extraction.tenant_id', $1, false)", [options.tenantId]);
  const rows = await intakes.query(
    "select intake_id::text, status, result_id::text from document_intake_extraction.intakes where tenant_id = $1 order by created_at",
    [options.tenantId],
  );
  console.log(`drain finished: ${completed} completed this run, ${remaining} still pending`);
  for (const row of rows.rows) console.log(`  intake ${row.intake_id}: ${row.status}${row.result_id ? ` (result ${row.result_id})` : ""}`);
} finally {
  intakes.release();
  await pool.end();
}
process.exit(remaining === 0 ? 0 : 2);
