// Shared local composition pieces for the V4 service: the local-disk S3
// client, provider suite (primary + repair ladder + native lane), admission
// controller shape, and worker fleet. Used by the isolated dev runner and by
// the flag-gated app mount so both run the same wiring instead of twins.

import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile as execFileCallback } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import { SERVICE_LIMITS } from "../../../packages/extraction-contracts/index.mjs";

import { AdaptiveProviderAdmissionController } from "../capacity/adaptive-provider-admission.mjs";
import { createGemini37RangeAdapter } from "../providers/gemini37-range-adapter.mjs";
import { createGemini37RepairPageAdapter } from "../providers/gemini37-repair-adapter.mjs";
import { createGpt54RepairPageAdapter } from "../providers/gpt54-repair-adapter.mjs";
import { createMistralOcr41PageAdapter } from "../providers/mistral-ocr41-adapter.mjs";
import { createMistralOcr41RangeAdapter } from "../providers/mistral-ocr41-range-adapter.mjs";
import { createNativeTextPageProvider } from "../../../workers/document-processing/native-text-page-provider.mjs";
import { PdfPageMaterializer } from "../../../workers/document-processing/pdf-page-materializer.mjs";
import { WorkerScratchSpace } from "../../../workers/document-processing/worker-scratch-space.mjs";

const execFilePromise = promisify(execFileCallback);

export async function rasterizePageToPng(source) {
  const outPrefix = `${source.filePath}.apex`;
  await execFilePromise("pdftoppm", ["-f", "1", "-l", "1", "-r", "150", "-png", "-singlefile", source.filePath, outPrefix], { timeout: 60_000 });
  return readFile(`${outPrefix}.png`);
}

// Local-disk stand-ins for the S3 presigner and client so the REAL production
// S3CompatibleObjectStore custody path (versioned staging, streamed hash
// verification, content-addressed promotion, Postgres custody bookkeeping)
// runs with bytes on the local filesystem instead of a bucket.
// Single containment-checked path resolver for every local-store writer: a
// key may never escape its bucket root, whichever entry point wrote it.
export function resolveLocalObjectPath(root, bucket, key) {
  const resolved = path.resolve(root, bucket, key);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) {
    const error = new Error("object key escaped local store root");
    error.code = "object.key_invalid";
    throw error;
  }
  return resolved;
}

export function localObjectMetaPath(target) {
  return `${target}.s3meta.json`;
}

export function createLocalDiskS3({ root }) {
  const objectPath = (bucket, key) => resolveLocalObjectPath(root, bucket, key);
  const metaPath = localObjectMetaPath;
  async function readMeta(target) {
    try {
      return JSON.parse(await readFile(metaPath(target), "utf8"));
    } catch {
      return {};
    }
  }
  const presigner = {
    async presignPut({ bucket, key }) {
      const target = objectPath(bucket, key);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      return { url: `file://${target}` };
    },
  };
  const client = {
    async headBucket({ bucket }) {
      await mkdir(path.resolve(root, bucket), { recursive: true, mode: 0o700 });
      return {};
    },
    async headObject({ bucket, key }) {
      const target = objectPath(bucket, key);
      const details = await stat(target);
      const meta = await readMeta(target);
      return { contentLength: details.size, versionId: meta.versionId || "", metadata: meta.metadata || {} };
    },
    async getObject({ bucket, key }) {
      const target = objectPath(bucket, key);
      await stat(target);
      return { body: createReadStream(target) };
    },
    async copyObject({ sourceBucket, sourceKey, destinationBucket, destinationKey, metadata }) {
      const source = objectPath(sourceBucket, sourceKey);
      const destination = objectPath(destinationBucket, destinationKey);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      // Atomic promotion: copy to a unique temp file and rename into place, so
      // a concurrent reader can never observe a partially copied blob. The
      // metadata sidecar lands BEFORE the blob so blob-present implies
      // meta-present. Concurrent committers of the same content-addressed key
      // carry identical bytes and identical metadata, so last-rename-wins is
      // convergent, not lossy.
      const temporary = `${destination}.${process.pid}.${randomUUID()}.partial`;
      const metaTemporary = `${metaPath(destination)}.${process.pid}.${randomUUID()}.partial`;
      try {
        await copyFile(source, temporary);
        // The sidecar must be atomic too: concurrent committers rewrite the
        // same sidecar path, and a reader that catches a half-written JSON
        // file fails custody verification exactly like a half-copied blob.
        await writeFile(metaTemporary, `${JSON.stringify({ versionId: randomUUID(), metadata: metadata || {} }, null, 2)}\n`, { mode: 0o600 });
        await rename(metaTemporary, metaPath(destination));
        await rename(temporary, destination);
      } catch (error) {
        await rm(temporary, { force: true });
        await rm(metaTemporary, { force: true });
        throw error;
      }
      return {};
    },
    async deleteObject({ bucket, key }) {
      const target = objectPath(bucket, key);
      await rm(target, { force: true });
      await rm(metaPath(target), { force: true });
      return {};
    },
  };
  // Plays the browser: performs the presigned PUT by writing the staged bytes
  // plus a version marker, as a versioned bucket would assign.
  async function performPresignedPut(uploadAuthorization, bytes) {
    const target = fileURLToPath(uploadAuthorization.url);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { mode: 0o600 });
    await writeFile(metaPath(target), `${JSON.stringify({ versionId: randomUUID(), metadata: {} }, null, 2)}\n`, { mode: 0o600 });
  }
  return { presigner, client, performPresignedPut };
}

// Writes one staged object (bytes + version marker) under the local store —
// the server side of an emulated presigned PUT. Streams to a temporary file
// under a hard byte cap so an oversized upload can never be buffered whole in
// the server's heap, then renames into place.
export async function writeLocalObjectStream({
  root,
  bucket,
  key,
  stream,
  maximumBytes = SERVICE_LIMITS.maximumFileBytes,
}) {
  const target = resolveLocalObjectPath(root, bucket, key);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.partial`;
  let bytes = 0;
  try {
    await pipeline(
      stream,
      async function* bounded(source) {
        for await (const chunk of source) {
          bytes += chunk.length;
          if (bytes > maximumBytes) {
            const error = new Error(`staged upload exceeds the ${maximumBytes}-byte object limit`);
            error.code = "object.too_large";
            throw error;
          }
          yield chunk;
        }
      },
      createWriteStream(temporary, { mode: 0o600 }),
    );
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  await writeFile(localObjectMetaPath(target), `${JSON.stringify({ versionId: randomUUID(), metadata: {} }, null, 2)}\n`, { mode: 0o600 });
  return { bytes };
}

// Provider suite from configuration: Gemini range primary with the full
// escalation ladder (gemini page, mistral page when configured, GPT-5.4
// apex when configured) and the free native-text lane.
export function buildProviderSuite({
  geminiKey,
  mistralKey = "",
  openaiKey = "",
  primary = "gemini",
  apex = true,
  native = true,
  gptInputUsdPerMillionTokens = 1.25,
  gptOutputUsdPerMillionTokens = 7.5,
  // Optional per-run overrides of the primary range rung's timeout budget
  // (load certification tunes these against the post-custody SLO without a
  // code change). Undefined keeps each adapter's evidence-based default.
  rangeTimeoutMs = undefined,
  rangeFirstAttemptTimeoutMs = undefined,
} = {}) {
  if (!String(geminiKey || "").trim()) throw new Error("provider suite requires a Gemini API key");
  const geminiRepair = createGemini37RepairPageAdapter({ apiKey: geminiKey });
  const mistralPage = String(mistralKey || "").trim() ? createMistralOcr41PageAdapter({ apiKey: mistralKey }) : null;
  const apexProvider = apex && String(openaiKey || "").trim()
    ? createGpt54RepairPageAdapter({
      apiKey: openaiKey,
      inputUsdPerMillionTokens: gptInputUsdPerMillionTokens,
      outputUsdPerMillionTokens: gptOutputUsdPerMillionTokens,
      rasterize: rasterizePageToPng,
    })
    : null;
  const nativeProvider = native ? createNativeTextPageProvider() : null;
  const rangeTimeouts = {
    ...(rangeTimeoutMs !== undefined ? { timeoutMs: rangeTimeoutMs } : {}),
    ...(rangeFirstAttemptTimeoutMs !== undefined ? { firstAttemptTimeoutMs: rangeFirstAttemptTimeoutMs } : {}),
  };
  if (primary === "mistral") {
    if (!mistralPage) throw new Error("mistral primary requires MISTRAL_API_KEY");
    return {
      label: `Mistral OCR 4.1 range primary + ladder [gemini-page${apexProvider ? ", gpt-5.4 apex" : ""}]`,
      primaryProvider: createMistralOcr41RangeAdapter({ apiKey: mistralKey, ...rangeTimeouts }),
      repairProvider: geminiRepair,
      repairLadder: [geminiRepair, ...(apexProvider ? [apexProvider] : [])],
      apexProvider,
      nativeProvider,
    };
  }
  return {
    label: `Gemini 3.7 Flash range primary + ladder [gemini-page${mistralPage ? ", mistral-page" : ""}${apexProvider ? ", gpt-5.4 apex" : ""}]`,
    primaryProvider: createGemini37RangeAdapter({ apiKey: geminiKey, ...rangeTimeouts }),
    repairProvider: geminiRepair,
    repairLadder: [geminiRepair, ...(mistralPage ? [mistralPage] : []), ...(apexProvider ? [apexProvider] : [])],
    apexProvider,
    nativeProvider,
  };
}

export function buildAdmissionController({ suite, lanes = 24, minLanes = 2, repairLanes = 4, rangePages = 8, admissionRate = 40 } = {}) {
  return new AdaptiveProviderAdmissionController({
    capabilities: [
      {
        capability: suite.primaryProvider.capability,
        minimumConcurrent: minLanes,
        startConcurrent: minLanes,
        maximumConcurrent: lanes,
        pageOperationsPerSecond: admissionRate,
        burstPageOperations: Math.max(rangePages, lanes * rangePages),
      },
      // Repair rungs start near-idle and only grow under sustained spill —
      // slow-start/AIMD is the dynamic part; these are CEILINGS. Both load
      // evidence runs showed the middle (Mistral) rung pinned at 2
      // concurrent / 2 ops/s becoming the drain bottleneck when a
      // validation-hostile corpus or a primary outage spilled hundreds of
      // pages (82 admission deferrals on the calm run alone), so OCR rungs
      // now share the repair-lane budget; throttling is AIMD's job, not a
      // hard pin's. The apex rung stays deliberately small: it is the most
      // expensive read in the system and only ever sees pages two OCR rungs
      // already failed.
      ...suite.repairLadder.map((rung, index) => {
        const apex = suite.apexProvider && rung === suite.apexProvider;
        return {
          capability: rung.capability,
          minimumConcurrent: 1,
          startConcurrent: 1,
          maximumConcurrent: apex ? 3 : Math.max(index === 0 ? 2 : 4, repairLanes),
          pageOperationsPerSecond: apex ? 3 : Math.max(index === 0 ? 2 : 4, Math.round(admissionRate / 4)),
          burstPageOperations: apex ? 6 : Math.max(index === 0 ? 4 : 8, repairLanes * 2),
        };
      }),
      ...(suite.nativeProvider ? [{
        capability: suite.nativeProvider.capability,
        minimumConcurrent: 4,
        startConcurrent: 8,
        maximumConcurrent: 16,
        pageOperationsPerSecond: 500,
        burstPageOperations: 1000,
      }] : []),
    ],
  });
}

export function suiteProviderStages(suite) {
  return [
    ...(suite.nativeProvider ? [{ stage: "native_text", ...suite.nativeProvider.capability, workShare: 0.4, fallback: { pageOperationsPerSecond: 50 } }] : []),
    { stage: "primary_ocr", ...suite.primaryProvider.capability, workShare: 0.5, fallback: { pageOperationsPerSecond: 4 } },
    { stage: "selective_repair", ...suite.repairProvider.capability, workShare: 0.1, fallback: { pageOperationsPerSecond: 0.5 } },
  ];
}

// One worker loop per lane kind: the range primary, each repair rung, and the
// free native lane. Returns the run promises; abort the signal to stop.
export function startWorkerFleet({ composition, suite, tenantId, scratchRoot, lanes = 24, repairLanes = 4, rangePages = 8, signal, onOutcome = () => () => {} }) {
  const pageMaterializer = new PdfPageMaterializer();
  const runs = [];
  runs.push(composition.createWorkerLoop({
    worker: composition.createRangeWorker({
      scratchSpace: new WorkerScratchSpace({ root: path.join(scratchRoot, "range") }),
      pageMaterializer,
      maximumPages: rangePages,
    }),
    tenantId,
    workerIdPrefix: "v4-range",
    concurrency: lanes,
    idlePollMs: 200,
    onOutcome: onOutcome("range"),
  }).run({ signal }));
  suite.repairLadder.forEach((rung, index) => {
    // Worker lanes must be able to exploit the admission ceilings above:
    // OCR rungs get the repair-lane budget (idle lanes cost ~nothing — they
    // park on the idle-poll backoff), the apex rung keeps its cost cap.
    const apex = suite.apexProvider && rung === suite.apexProvider;
    runs.push(composition.createWorkerLoop({
      worker: composition.createRepairWorker({
        scratchSpace: new WorkerScratchSpace({ root: path.join(scratchRoot, `repair-${index}`) }),
        pageMaterializer,
        provider: rung,
      }),
      tenantId,
      workerIdPrefix: `v4-repair-${index}`,
      concurrency: apex ? 3 : Math.max(index === 0 ? 2 : 4, repairLanes),
      idlePollMs: 400,
      onOutcome: onOutcome(index === 0 ? "repair" : `rung${index + 1}:${rung.capability.provider}`),
    }).run({ signal }));
  });
  if (suite.nativeProvider) {
    runs.push(composition.createWorkerLoop({
      worker: composition.createRepairWorker({
        scratchSpace: new WorkerScratchSpace({ root: path.join(scratchRoot, "native") }),
        pageMaterializer,
        provider: suite.nativeProvider,
      }),
      tenantId,
      workerIdPrefix: "v4-native",
      concurrency: 8,
      idlePollMs: 100,
      onOutcome: onOutcome("native"),
    }).run({ signal }));
  }
  return runs;
}
