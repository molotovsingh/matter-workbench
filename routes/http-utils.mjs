import { makeHttpError } from "../shared/safe-paths.mjs";

export const DEFAULT_JSON_BODY_MAX_BYTES = 1024 * 1024;

export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

export async function readRequestJson(request, { maxBodyBytes = DEFAULT_JSON_BODY_MAX_BYTES } = {}) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBodyBytes) {
      throw makeHttpError("JSON request body too large", 413);
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
