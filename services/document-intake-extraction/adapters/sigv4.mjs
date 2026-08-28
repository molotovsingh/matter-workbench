import { createHash, createHmac } from "node:crypto";

// AWS Signature Version 4 signing for S3-compatible object stores
// (DigitalOcean Spaces in production, AWS S3 by construction). Two shapes:
// header-signed requests for server-side calls, and query-presigned URLs for
// browser uploads. Hand-rolled deliberately: the repository carries no AWS
// SDK, the algorithm is stable and fully specified, and the implementation is
// pinned by the official AWS documentation test vectors in the test suite.

export const EMPTY_PAYLOAD_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

/**
 * Sign a request with SigV4 headers. Returns the headers to send, including
 * Authorization, x-amz-date, and x-amz-content-sha256.
 */
export function signRequestHeaders({
  method,
  url,
  headers = {},
  payloadSha256 = EMPTY_PAYLOAD_SHA256,
  accessKeyId,
  secretAccessKey,
  region,
  service = "s3",
  now = new Date(),
} = {}) {
  const target = requireUrl(url);
  const { amzDate, dateStamp } = timestamps(now);
  const allHeaders = normalizeHeaders({
    ...headers,
    host: target.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadSha256,
  });
  const signedHeaderNames = Object.keys(allHeaders).sort();
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonical = [
    String(method).toUpperCase(),
    canonicalPath(target.pathname),
    canonicalQuery(target.searchParams),
    signedHeaderNames.map((name) => `${name}:${allHeaders[name]}\n`).join(""),
    signedHeaderNames.join(";"),
    payloadSha256,
  ].join("\n");
  const signature = sign({
    secretAccessKey,
    dateStamp,
    region,
    service,
    stringToSign: stringToSign(amzDate, scope, canonical),
  });
  return {
    ...allHeaders,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`,
  };
}

/**
 * Produce a presigned URL for the request. `headers` lists the headers the
 * eventual caller MUST send byte-identically (host is added automatically);
 * the payload is unsigned, as S3 requires for presigned uploads.
 */
export function presignUrl({
  method,
  url,
  headers = {},
  expiresSeconds,
  accessKeyId,
  secretAccessKey,
  region,
  service = "s3",
  now = new Date(),
} = {}) {
  const target = requireUrl(url);
  const { amzDate, dateStamp } = timestamps(now);
  const expires = Math.max(1, Math.min(604_800, Math.floor(Number(expiresSeconds))));
  if (!Number.isFinite(expires)) throw new Error("presign requires expiresSeconds");
  const signedHeaders = normalizeHeaders({ ...headers, host: target.host });
  const signedHeaderNames = Object.keys(signedHeaders).sort();
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const query = new URLSearchParams(target.searchParams);
  query.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  query.set("X-Amz-Credential", `${accessKeyId}/${scope}`);
  query.set("X-Amz-Date", amzDate);
  query.set("X-Amz-Expires", String(expires));
  query.set("X-Amz-SignedHeaders", signedHeaderNames.join(";"));
  const canonical = [
    String(method).toUpperCase(),
    canonicalPath(target.pathname),
    canonicalQuery(query),
    signedHeaderNames.map((name) => `${name}:${signedHeaders[name]}\n`).join(""),
    signedHeaderNames.join(";"),
    UNSIGNED_PAYLOAD,
  ].join("\n");
  const signature = sign({
    secretAccessKey,
    dateStamp,
    region,
    service,
    stringToSign: stringToSign(amzDate, scope, canonical),
  });
  query.set("X-Amz-Signature", signature);
  const presigned = new URL(target);
  presigned.search = "";
  return `${presigned.origin}${presigned.pathname}?${canonicalQuery(query)}`;
}

function stringToSign(amzDate, scope, canonicalRequest) {
  return ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
}

function sign({ secretAccessKey, dateStamp, region, service, stringToSign: value }) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  return createHmac("sha256", kSigning).update(value, "utf8").digest("hex");
}

function timestamps(now) {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function normalizeHeaders(headers) {
  const normalized = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    normalized[String(name).toLowerCase().trim()] = String(value).trim().replace(/\s+/g, " ");
  }
  return normalized;
}

/** RFC 3986 encoding of each path segment, preserving "/" separators. */
export function canonicalPath(pathname) {
  return String(pathname || "/")
    .split("/")
    .map((segment) => rfc3986Encode(decodeSafely(segment)))
    .join("/") || "/";
}

function canonicalQuery(searchParams) {
  const pairs = [];
  for (const [name, value] of searchParams) {
    pairs.push([rfc3986Encode(name), rfc3986Encode(value)]);
  }
  pairs.sort(([aName, aValue], [bName, bValue]) => (aName < bName ? -1 : aName > bName ? 1 : aValue < bValue ? -1 : aValue > bValue ? 1 : 0));
  return pairs.map(([name, value]) => `${name}=${value}`).join("&");
}

function rfc3986Encode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function decodeSafely(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function requireUrl(url) {
  if (url instanceof URL) return url;
  return new URL(String(url));
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

export function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
