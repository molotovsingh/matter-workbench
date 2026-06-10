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
  return String(value || "Unexpected mothership error")
    .replace(/postgres:\/\/([^:@/\s]+):([^@/\s]+)@/gi, "postgres://$1:***@")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~-]+/gi, "$1[redacted-secret]")
    .replace(/\b(mwb_ing_)[A-Za-z0-9_-]+/gi, "$1[redacted-secret]")
    .replace(/\b(password|token|secret)\s*[:=]\s*([^\s"'`]+)/gi, "$1=[redacted-secret]")
    .slice(0, 500);
}
