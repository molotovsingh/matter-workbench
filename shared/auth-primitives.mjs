import crypto from "node:crypto";

export const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";

export function hashPassword(password, {
  iterations = 210_000,
  salt,
  saltBytes = 16,
  hashBytes = 32,
} = {}) {
  const saltBuffer = salt === undefined
    ? crypto.randomBytes(saltBytes)
    : (Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt)));
  const iterationCount = positiveInt(iterations, 210_000);
  const hash = crypto.pbkdf2Sync(String(password), saltBuffer, iterationCount, hashBytes, "sha256");
  return [
    PASSWORD_HASH_ALGORITHM,
    String(iterationCount),
    saltBuffer.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

export function verifyPasswordHash(password, encodedHash) {
  const parsed = parsePasswordHash(encodedHash);
  if (!parsed) return false;
  const candidate = crypto.pbkdf2Sync(
    String(password),
    parsed.salt,
    parsed.iterations,
    parsed.hash.length,
    "sha256",
  );
  return secureBufferEqual(candidate, parsed.hash);
}

export function parsePasswordHash(encodedHash) {
  const [algorithm, iterationsText, saltText, hashText] = String(encodedHash || "").split("$");
  if (algorithm !== PASSWORD_HASH_ALGORITHM || !iterationsText || !saltText || !hashText) return null;
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations <= 0) return null;
  try {
    const salt = Buffer.from(saltText, "base64url");
    const hash = Buffer.from(hashText, "base64url");
    if (!salt.length || !hash.length) return null;
    return { iterations, salt, hash };
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader = "") {
  const cookies = {};
  for (const part of String(cookieHeader || "").split(";")) {
    const [rawName, ...rawValue] = part.split("=");
    const name = rawName.trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(rawValue.join("=") || "");
  }
  return cookies;
}

export function serializeCookie(name, value, { maxAgeSeconds, secure = false, httpOnly = true, sameSite = "Strict", path: cookiePath = "/" } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${cookiePath}`];
  if (httpOnly) parts.push("HttpOnly");
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (Number.isFinite(maxAgeSeconds)) parts.push(`Max-Age=${maxAgeSeconds}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(name, { secure = false, httpOnly = true, sameSite = "Strict", path: cookiePath = "/" } = {}) {
  const parts = [`${name}=`, `Path=${cookiePath}`];
  if (httpOnly) parts.push("HttpOnly");
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  parts.push("Max-Age=0");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) {
    crypto.timingSafeEqual(
      crypto.createHash("sha256").update(leftBuffer).digest(),
      crypto.createHash("sha256").update(rightBuffer).digest(),
    );
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function secureBufferEqual(leftBuffer, rightBuffer) {
  if (leftBuffer.length !== rightBuffer.length) {
    crypto.timingSafeEqual(
      crypto.createHash("sha256").update(leftBuffer).digest(),
      crypto.createHash("sha256").update(rightBuffer).digest(),
    );
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function shouldUseSecureCookie(env = {}, {
  explicitVar,
  publicUrlVars = [],
} = {}) {
  const explicit = String(env[explicitVar] || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(explicit)) return true;
  if (["0", "false", "no", "off"].includes(explicit)) return false;
  for (const publicUrlVar of publicUrlVars) {
    const publicUrl = String(env[publicUrlVar] || "").trim();
    if (/^https:\/\//i.test(publicUrl)) return true;
  }
  return false;
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
