// Shared local composition pieces for the V4 service: the local-disk S3
// client, provider suite (primary + repair ladder + native lane), admission
// controller shape, and worker fleet. Used by the isolated dev runner and by
// the flag-gated app mount so both run the same wiring instead of twins.

import { constants as fsConstants, createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

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
export function createLocalDiskS3({ root }) {
  const objectPath = (bucket, key) => {
    const resolved = path.resolve(root, bucket, key);
    if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error("object key escaped local store root");
    return resolved;
  };
  const metaPath = (target) => `${target}.s3meta.json`;
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
      try {
        await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      await writeFile(metaPath(destination), `${JSON.stringify({ versionId: randomUUID(), metadata: metadata || {} }, null, 2)}\n`, { mode: 0o600 });
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
// the server side of an emulated presigned PUT.
export async function writeLocalObject({ root, bucket, key, bytes }) {
  const target = path.resolve(root, bucket, key);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error("object key escaped local store root");
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, bytes, { mode: 0o600 });
  await writeFile(`${target}.s3meta.json`, `${JSON.stringify({ versionId: randomUUID(), metadata: {} }, null, 2)}\n`, { mode: 0o600 });
  return { bytes: bytes.length };
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
  if (primary === "mistral") {
    if (!mistralPage) throw new Error("mistral primary requires MISTRAL_API_KEY");
    return {
      label: `Mistral OCR 4.1 range primary + ladder [gemini-page${apexProvider ? ", gpt-5.4 apex" : ""}]`,
      primaryProvider: createMistralOcr41RangeAdapter({ apiKey: mistralKey }),
      repairProvider: geminiRepair,
      repairLadder: [geminiRepair, ...(apexProvider ? [apexProvider] : [])],
      nativeProvider,
    };
  }
  return {
    label: `Gemini 3.7 Flash range primary + ladder [gemini-page${mistralPage ? ", mistral-page" : ""}${apexProvider ? ", gpt-5.4 apex" : ""}]`,
    primaryProvider: createGemini37RangeAdapter({ apiKey: geminiKey }),
    repairProvider: geminiRepair,
    repairLadder: [geminiRepair, ...(mistralPage ? [mistralPage] : []), ...(apexProvider ? [apexProvider] : [])],
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
      ...suite.repairLadder.map((rung, index) => ({
        capability: rung.capability,
        minimumConcurrent: 1,
        startConcurrent: 1,
        maximumConcurrent: index === 0 ? Math.max(2, repairLanes) : 2,
        pageOperationsPerSecond: index === 0 ? Math.max(2, Math.round(admissionRate / 4)) : 2,
        burstPageOperations: index === 0 ? Math.max(4, repairLanes * 2) : 4,
      })),
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
    runs.push(composition.createWorkerLoop({
      worker: composition.createRepairWorker({
        scratchSpace: new WorkerScratchSpace({ root: path.join(scratchRoot, `repair-${index}`) }),
        pageMaterializer,
        provider: rung,
      }),
      tenantId,
      workerIdPrefix: `v4-repair-${index}`,
      concurrency: index === 0 ? repairLanes : 2,
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
