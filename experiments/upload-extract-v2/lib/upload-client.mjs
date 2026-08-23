import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { mapWithConcurrency, nowIso, positiveInteger, readJson, safeExperimentId } from "./util.mjs";

export async function uploadFixture({
  fixtureDir,
  baseUrl,
  token,
  sessionId,
  concurrency = 4,
  stopAfter = 0,
  onProgress = () => {},
} = {}) {
  if (!fixtureDir) throw new Error("fixture directory is required");
  if (!baseUrl) throw new Error("base URL is required");
  if (!token) throw new Error("V2 upload token is required");
  const id = safeExperimentId(sessionId, "session id");
  const fixtureRoot = path.resolve(fixtureDir);
  const fixture = await readJson(path.join(fixtureRoot, "fixture.json"));
  const files = normalizeFixtureFiles(fixture.files, fixtureRoot);
  const boundedConcurrency = positiveInteger(concurrency, 4, { max: 16 });
  const runId = safeExperimentId(`upload-${Date.now()}`, "run id");
  const startedAt = nowIso();
  const started = performance.now();
  let peakRssBytes = process.memoryUsage().rss;
  const memoryTimer = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 100);
  memoryTimer.unref?.();

  let attemptedFiles = 0;
  let completedFiles = 0;
  let uploadedBytes = 0;
  let error = "";
  try {
    await requestJson(`${baseUrl}/v2/sessions`, {
      method: "POST",
      token,
      body: {
        id,
        fixtureId: fixture.fixtureId || "",
        files: files.map(({ absoluteSourcePath: _absoluteSourcePath, ...descriptor }) => descriptor),
      },
    });
    const before = await requestJson(`${baseUrl}/v2/sessions/${id}`, { token });
    const uploaded = new Set(before.files.filter((file) => file.uploadStatus === "uploaded").map((file) => file.index));
    const pending = files.filter((file) => !uploaded.has(file.index));
    const selected = stopAfter > 0 ? pending.slice(0, positiveInteger(stopAfter, pending.length)) : pending;
    attemptedFiles = selected.length;

    await mapWithConcurrency(selected, boundedConcurrency, async (file) => {
      await putFile(`${baseUrl}/v2/sessions/${id}/files/${file.index}`, {
        token,
        filePath: file.absoluteSourcePath,
        expectedBytes: file.expectedBytes,
      });
      completedFiles += 1;
      uploadedBytes += file.expectedBytes;
      onProgress({ completedFiles, attemptedFiles, uploadedBytes, fileIndex: file.index });
    });

    const after = await requestJson(`${baseUrl}/v2/sessions/${id}`, { token });
    if (after.counts.uploaded === after.counts.total) {
      await requestJson(`${baseUrl}/v2/sessions/${id}/commit`, { method: "POST", token, body: {} });
    }
  } catch (caught) {
    error = safeError(caught);
    throw caught;
  } finally {
    clearInterval(memoryTimer);
    const finishedAt = nowIso();
    const run = {
      runId,
      startedAt,
      finishedAt,
      wallMs: Math.round(performance.now() - started),
      activeMs: Math.round(performance.now() - started),
      concurrency: boundedConcurrency,
      attemptedFiles,
      completedFiles,
      uploadedBytes,
      peakRssBytes,
      error,
    };
    await requestJson(`${baseUrl}/v2/sessions/${id}/upload-runs`, {
      method: "POST",
      token,
      body: run,
    }).catch(() => {});
  }

  return requestJson(`${baseUrl}/v2/sessions/${id}`, { token });
}

function normalizeFixtureFiles(files, fixtureRoot) {
  if (!Array.isArray(files) || !files.length) throw new Error("fixture has no files");
  return files.map((file) => {
    const sourceFile = String(file.sourceFile || "");
    const absoluteSourcePath = path.resolve(fixtureRoot, sourceFile);
    if (!absoluteSourcePath.startsWith(`${fixtureRoot}${path.sep}`)) throw new Error("fixture source path escapes fixture root");
    return {
      index: Number(file.index),
      relativePath: String(file.relativePath || ""),
      originalName: String(file.originalName || ""),
      mimeType: String(file.mimeType || ""),
      expectedBytes: Number(file.expectedBytes),
      sha256: String(file.sha256 || ""),
      sourceKind: String(file.sourceKind || "real"),
      baseline: file.baseline && typeof file.baseline === "object" ? file.baseline : {},
      absoluteSourcePath,
    };
  });
}

async function putFile(urlValue, { token, filePath, expectedBytes }) {
  const info = await stat(filePath);
  if (info.size !== expectedBytes) throw new Error(`fixture size changed for ${path.basename(filePath)}`);
  const url = new URL(urlValue);
  const transport = url.protocol === "https:" ? https : http;
  await new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": expectedBytes,
        "x-v2-token": token,
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if ((response.statusCode || 500) >= 400) return reject(httpError(response.statusCode, text));
        resolve();
      });
    });
    request.on("error", reject);
    const source = createReadStream(filePath);
    source.on("error", (error) => request.destroy(error));
    source.pipe(request);
  });
}

export async function requestJson(urlValue, { method = "GET", token = "", body } = {}) {
  const url = new URL(urlValue);
  const transport = url.protocol === "https:" ? https : http;
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method,
      headers: {
        accept: "application/json",
        ...(token ? { "x-v2-token": token } : {}),
        ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed;
        try {
          parsed = JSON.parse(text || "{}");
        } catch {
          parsed = { error: text || `HTTP ${response.statusCode}` };
        }
        if ((response.statusCode || 500) >= 400) return reject(httpError(response.statusCode, parsed.error || text));
        resolve(parsed);
      });
    });
    request.on("error", reject);
    if (payload) request.end(payload);
    else request.end();
  });
}

function httpError(statusCode, message) {
  const error = new Error(String(message || `HTTP ${statusCode}`));
  error.statusCode = Number(statusCode) || 500;
  return error;
}

function safeError(error) {
  return String(error?.message || error || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 500);
}
