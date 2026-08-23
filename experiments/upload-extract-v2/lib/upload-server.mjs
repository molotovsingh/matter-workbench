import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import http from "node:http";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

import { V2SessionStore } from "./session-store.mjs";
import { objectPath, safeExperimentId, sessionDir } from "./util.mjs";

const JSON_BODY_LIMIT = 2 * 1024 * 1024;

export function createV2UploadServer({ root, token, logger = console } = {}) {
  if (!root) throw new Error("experiment root is required");
  if (!token) throw new Error("V2 upload token is required");
  const store = new V2SessionStore({ root });
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        return sendJson(response, 200, { status: "ready", schemaVersion: "upload-extract-v2/http-v1" });
      }
      assertAuthorized(request, token);
      const url = new URL(request.url || "/", "http://127.0.0.1");

      if (request.method === "POST" && url.pathname === "/v2/sessions") {
        const body = await readJsonBody(request);
        const session = await store.createSession({ id: body.id, files: body.files, fixtureId: body.fixtureId });
        return sendJson(response, 200, sessionSummary(session));
      }

      const sessionMatch = url.pathname.match(/^\/v2\/sessions\/([a-zA-Z0-9_-]+)$/);
      if (request.method === "GET" && sessionMatch) {
        const session = await store.readSession(sessionMatch[1]);
        return sendJson(response, 200, sessionSummary(session));
      }

      const fileMatch = url.pathname.match(/^\/v2\/sessions\/([a-zA-Z0-9_-]+)\/files\/(\d+)$/);
      if (request.method === "PUT" && fileMatch) {
        const result = await receiveFile({
          request,
          root,
          store,
          sessionId: fileMatch[1],
          fileIndex: Number(fileMatch[2]),
        });
        return sendJson(response, 200, result);
      }

      const commitMatch = url.pathname.match(/^\/v2\/sessions\/([a-zA-Z0-9_-]+)\/commit$/);
      if (request.method === "POST" && commitMatch) {
        const session = await store.commitSession(commitMatch[1]);
        return sendJson(response, 200, sessionSummary(session));
      }

      const runMatch = url.pathname.match(/^\/v2\/sessions\/([a-zA-Z0-9_-]+)\/upload-runs$/);
      if (request.method === "POST" && runMatch) {
        const run = await readJsonBody(request);
        const session = await store.recordUploadRun(runMatch[1], run);
        return sendJson(response, 200, sessionSummary(session));
      }

      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, Number(error?.statusCode) || 500, { error: safeError(error) });
      } else {
        response.destroy(error);
      }
      if (Number(error?.statusCode) >= 500 || !error?.statusCode) logger?.error?.(`[upload-extract-v2] ${safeError(error)}`);
    }
  });

  return {
    server,
    store,
    async listen({ host = "127.0.0.1", port = 4299 } = {}) {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      return { host, port: typeof address === "object" && address ? address.port : port };
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function receiveFile({ request, root, store, sessionId, fileIndex }) {
  const id = safeExperimentId(sessionId, "session id");
  const existing = await store.uploadedFile(id, fileIndex);
  if (existing) {
    request.resume();
    return { status: "already_uploaded", index: fileIndex, bytes: existing.file.expectedBytes };
  }

  const session = await store.readSession(id);
  const file = session.files.find((candidate) => candidate.index === fileIndex);
  if (!file) {
    const error = new Error(`session file not found: ${fileIndex}`);
    error.statusCode = 404;
    throw error;
  }
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength !== file.expectedBytes) {
    const error = new Error(`content length mismatch for file index ${fileIndex}`);
    error.statusCode = 409;
    throw error;
  }

  await store.markUploadStarted(id, fileIndex);
  const finalPath = objectPath(root, id, fileIndex);
  const tempPath = path.join(sessionDir(root, id), "incoming", `${String(fileIndex).padStart(6, "0")}.${randomUUID()}.part`);
  await mkdir(path.dirname(tempPath), { recursive: true, mode: 0o700 });
  const meter = new HashingMeter(file.expectedBytes);
  try {
    await pipeline(request, meter, createWriteStream(tempPath, { flags: "wx", mode: 0o600 }));
    const result = meter.result();
    if (result.size !== file.expectedBytes || result.sha256 !== file.sha256) {
      const error = new Error(`payload verification failed for file index ${fileIndex}`);
      error.statusCode = 409;
      throw error;
    }
    await mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 });
    await rename(tempPath, finalPath);
    await store.markUploadSucceeded(id, fileIndex, { receivedBytes: result.size, sha256: result.sha256 });
    return { status: "uploaded", index: fileIndex, bytes: result.size };
  } catch (error) {
    await rm(tempPath, { force: true });
    await store.markUploadFailed(id, fileIndex, error).catch(() => {});
    throw error;
  }
}

class HashingMeter extends Transform {
  constructor(limit) {
    super();
    this.limit = Math.max(0, Number(limit) || 0);
    this.size = 0;
    this.hash = createHash("sha256");
  }

  _transform(chunk, _encoding, callback) {
    this.size += chunk.length;
    if (this.size > this.limit) return callback(new Error("upload exceeded expected size"));
    this.hash.update(chunk);
    callback(null, chunk);
  }

  result() {
    return { size: this.size, sha256: this.hash.digest("hex") };
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > JSON_BODY_LIMIT) {
      const error = new Error("JSON request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("Invalid JSON request body");
    error.statusCode = 400;
    throw error;
  }
}

function assertAuthorized(request, expected) {
  const actual = String(request.headers["x-v2-token"] || "");
  const left = Buffer.from(actual);
  const right = Buffer.from(String(expected));
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }
}

function sessionSummary(session) {
  const counts = {
    total: session.files.length,
    uploaded: session.files.filter((file) => file.upload.status === "uploaded").length,
    failed: session.files.filter((file) => file.upload.status === "failed").length,
    filtered: session.files.filter((file) => file.commitDisposition === "filtered").length,
    extractable: session.files.filter((file) => file.commitDisposition === "ready").length,
    extracted: session.files.filter((file) => file.extraction.status === "succeeded").length,
  };
  return {
    schemaVersion: session.schemaVersion,
    id: session.id,
    state: session.state,
    descriptorFingerprint: session.descriptorFingerprint,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    committedAt: session.committedAt,
    counts,
    files: session.files.map((file) => ({
      index: file.index,
      relativePath: file.relativePath,
      expectedBytes: file.expectedBytes,
      sha256: file.sha256,
      uploadStatus: file.upload.status,
      commitDisposition: file.commitDisposition,
      extractionStatus: file.extraction.status,
    })),
  };
}

function sendJson(response, statusCode, body) {
  const bytes = Buffer.from(`${JSON.stringify(body)}\n`);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": bytes.length,
    "cache-control": "no-store",
  });
  response.end(bytes);
}

function safeError(error) {
  return String(error?.message || error || "Unknown error").replace(/[\r\n\t]+/g, " ").trim().slice(0, 500);
}
