import path from "node:path";
import fs from "node:fs";

import { clearCookie, parseCookies, serializeCookie } from "../shared/auth-primitives.mjs";
import { redactSensitiveText } from "../shared/secret-redaction.mjs";
import { isInsideRoot } from "../shared/safe-paths.mjs";

export async function readJsonBody(request, { maxBodyBytes = 256 * 1024 } = {}) {
  const declared = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(declared) && declared > maxBodyBytes) throw httpError("Request body is too large", 413);

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBodyBytes) throw httpError("Request body is too large", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw httpError("Request body must be valid JSON", 400);
  }
}

export function readBearerToken(request) {
  const authorization = String(request.headers.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]?.trim()) throw httpError("Missing ingestion token", 401);
  return match[1].trim();
}

export function sendJson(response, statusCode, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

export function httpError(message, statusCode = 500) {
  const error = new Error(redactErrorText(message));
  error.statusCode = statusCode;
  return error;
}

export function redactErrorText(value) {
  return redactSensitiveText(String(value || "Unexpected mothership error")).slice(0, 500);
}

export { clearCookie, parseCookies, serializeCookie } from "../shared/auth-primitives.mjs";

export function readCookie(request, name) {
  const cookies = parseCookies(request.headers?.cookie || "");
  return cookies[name] || "";
}

const STATIC_CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export async function serveStaticAsset({ assetRoot, requestUrl, response, readFile, fallbackToIndex = true }) {
  const root = path.resolve(assetRoot);
  const read = readFile || ((filePath) => fs.promises.readFile(filePath));

  const safePath = resolveStaticPath(root, requestUrl, fallbackToIndex);
  if (!safePath) return false;

  const ext = path.extname(safePath).toLowerCase();
  const contentType = STATIC_CONTENT_TYPES[ext] || "application/octet-stream";
  try {
    const body = await read(safePath);
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600",
    });
    response.end(body);
    return true;
  } catch {
    if (!fallbackToIndex) return false;
    return serveIndex(root, response, read);
  }
}

function resolveStaticPath(root, requestUrl, fallbackToIndex) {
  let rawPath = "/";
  if (requestUrl && typeof requestUrl.pathname === "string") {
    rawPath = decodeURIComponent(requestUrl.pathname || "/");
  } else {
    try {
      rawPath = decodeURIComponent(new URL(requestUrl?.url || "/", "http://localhost").pathname || "/");
    } catch {
      rawPath = "/";
    }
  }
  if (rawPath === "/" || rawPath === "") return fallbackToIndex ? path.join(root, "index.html") : null;
  const relativePath = rawPath.replace(/^\/+/, "");
  const resolved = path.resolve(root, relativePath);
  if (!isInsideRoot(root, resolved)) return null;
  return resolved;
}

function serveIndex(root, response, read) {
  const indexPath = path.join(root, "index.html");
  return read(indexPath)
    .then((body) => {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
      });
      response.end(body);
      return true;
    })
    .catch(() => false);
}
