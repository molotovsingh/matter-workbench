import crypto from "node:crypto";

const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
const DEFAULT_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_LOGIN_MAX_ATTEMPTS = 5;
const DEFAULT_LOGIN_WINDOW_SECONDS = 5 * 60;
const SESSION_COOKIE = "mwb_mothership_console_session";

export function createConsoleAuthService({
  env = process.env,
  now = Date.now,
  tokenBytes = (length) => crypto.randomBytes(length),
} = {}) {
  const enabled = isConsoleAuthEnabled(env);
  const operatorUsername = enabled ? String(env.MOTHERSHIP_CONSOLE_USERNAME || "").trim() : "";
  const operatorPasswordHash = enabled ? String(env.MOTHERSHIP_CONSOLE_PASSWORD_HASH || "").trim() : "";
  if (enabled && (!operatorUsername || !operatorPasswordHash || !parsePasswordHash(operatorPasswordHash))) {
    throw new Error(
      "MOTHERSHIP_CONSOLE_USERNAME and a valid MOTHERSHIP_CONSOLE_PASSWORD_HASH (pbkdf2-sha256$<iterations>$<saltB64url>$<hashB64url>) are required when the console is enabled.",
    );
  }
  const ttlSeconds = positiveInt(env.MOTHERSHIP_CONSOLE_SESSION_TTL_SECONDS, DEFAULT_TTL_SECONDS);
  const secureCookie = shouldUseSecureCookie(env);
  const loginMaxAttempts = positiveInt(env.MOTHERSHIP_CONSOLE_LOGIN_MAX_ATTEMPTS, DEFAULT_LOGIN_MAX_ATTEMPTS);
  const loginWindowMs = positiveInt(env.MOTHERSHIP_CONSOLE_LOGIN_WINDOW_SECONDS, DEFAULT_LOGIN_WINDOW_SECONDS) * 1000;
  const sessions = new Map();
  const loginFailures = new Map();

  function requireAuth() {
    return enabled;
  }

  function sessionFromRequest(request = {}) {
    if (!enabled) return { user: { username: operatorUsername || "operator", role: "operator" } };
    const token = readSessionToken(request);
    if (!token) return null;
    const tokenHash = hashSessionToken(token);
    const session = sessions.get(tokenHash);
    if (!session) return null;
    if (session.expiresAt <= now()) {
      sessions.delete(tokenHash);
      return null;
    }
    return session;
  }

  function status(request = {}) {
    const session = sessionFromRequest(request);
    return {
      enabled,
      authenticated: !enabled || Boolean(session),
      user: enabled && session ? session.user : null,
    };
  }

  function login({ username = "", password = "" } = {}, options = {}) {
    if (!enabled) {
      return { ok: true, statusCode: 200, payload: status(), setCookie: "" };
    }
    const clientKey = loginClientKey(options);
    const throttle = throttleState(clientKey);
    if (throttle.blocked) {
      return {
        ok: false,
        statusCode: 429,
        payload: { error: "Too many login attempts. Try again later." },
        setCookie: "",
      };
    }
    const usernameMatch = secureEqual(String(username), operatorUsername);
    const passwordMatch = verifyPassword(String(password), operatorPasswordHash);
    const matched = usernameMatch && passwordMatch;
    if (!matched) {
      recordFailedLogin(clientKey);
      return {
        ok: false,
        statusCode: 401,
        payload: { error: "Invalid username or password" },
        setCookie: "",
      };
    }
    loginFailures.delete(clientKey);
    const token = newSessionToken(tokenBytes);
    const tokenHash = hashSessionToken(token);
    const user = { username: operatorUsername, role: "operator", displayName: "Operator" };
    const session = { user, expiresAt: now() + ttlSeconds * 1000 };
    sessions.set(tokenHash, session);
    return {
      ok: true,
      statusCode: 200,
      payload: { enabled, authenticated: true, user },
      setCookie: serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: ttlSeconds, secure: secureCookie }),
    };
  }

  function logout(request = {}) {
    if (!enabled) {
      return { ok: true, statusCode: 200, payload: status(), setCookie: clearCookie(SESSION_COOKIE, { secure: secureCookie }) };
    }
    const token = readSessionToken(request);
    if (token) sessions.delete(hashSessionToken(token));
    return {
      ok: true,
      statusCode: 200,
      payload: { enabled, authenticated: false, user: null },
      setCookie: clearCookie(SESSION_COOKIE, { secure: secureCookie }),
    };
  }

  function isAuthenticated(request = {}) {
    if (!enabled) return true;
    return Boolean(sessionFromRequest(request));
  }

  function sessionUser(request = {}) {
    const session = sessionFromRequest(request);
    return session?.user || null;
  }

  return {
    requireAuth,
    status,
    login,
    logout,
    isAuthenticated,
    sessionUser,
    sessionCookieName: SESSION_COOKIE,
    secureCookie,
  };

  function throttleState(clientKey) {
    const currentTime = now();
    const record = loginFailures.get(clientKey);
    if (!record || record.resetAt <= currentTime) return { blocked: false, count: 0 };
    if (record.count >= loginMaxAttempts) return { blocked: true, count: record.count };
    return { blocked: false, count: record.count };
  }

  function recordFailedLogin(clientKey) {
    const currentTime = now();
    const record = loginFailures.get(clientKey);
    if (!record || record.resetAt <= currentTime) {
      loginFailures.set(clientKey, { count: 1, resetAt: currentTime + loginWindowMs });
      return;
    }
    record.count += 1;
    record.resetAt = currentTime + loginWindowMs;
  }
}

export function hashConsolePassword(password, { iterations = 210_000, saltBytes = 16, hashBytes = 32 } = {}) {
  const salt = crypto.randomBytes(saltBytes);
  const hash = crypto.pbkdf2Sync(String(password), salt, iterations, hashBytes, "sha256");
  return [PASSWORD_HASH_ALGORITHM, iterations, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export function verifyPassword(password, encodedHash) {
  const parsed = parsePasswordHash(encodedHash);
  if (!parsed) return false;
  const candidate = crypto.pbkdf2Sync(String(password), parsed.salt, parsed.iterations, parsed.hash.length, "sha256");
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

function isConsoleAuthEnabled(env) {
  const mode = String(env.MOTHERSHIP_CONSOLE || env.MOTHERSHIP_CONSOLE_AUTH || "").trim().toLowerCase();
  return ["required", "true", "1", "yes", "on"].includes(mode);
}

function shouldUseSecureCookie(env) {
  const explicit = String(env.MOTHERSHIP_CONSOLE_COOKIE_SECURE || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(explicit)) return true;
  if (["0", "false", "no", "off"].includes(explicit)) return false;
  const publicUrl = String(env.MOTHERSHIP_CONSOLE_PUBLIC_URL || "").trim();
  return /^https:\/\//i.test(publicUrl);
}

function readSessionToken(request = {}) {
  const cookies = parseCookies(request.headers?.cookie || "");
  return String(cookies[SESSION_COOKIE] || "").trim();
}

function newSessionToken(tokenBytes) {
  return `mwb_console_${tokenBytes(32).toString("base64url")}`;
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function loginClientKey(options = {}) {
  if (typeof options.clientKey === "string" && options.clientKey.trim()) return options.clientKey.trim();
  const request = options.request || {};
  return String(request.socket?.remoteAddress || "local").trim() || "local";
}

function secureEqual(left, right) {
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

function secureBufferEqual(leftBuffer, rightBuffer) {
  if (leftBuffer.length !== rightBuffer.length) {
    crypto.timingSafeEqual(
      crypto.createHash("sha256").update(leftBuffer).digest(),
      crypto.createHash("sha256").update(rightBuffer).digest(),
    );
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCookies(cookieHeader = "") {
  const cookies = {};
  for (const part of String(cookieHeader || "").split(";")) {
    const [rawName, ...rawValue] = part.split("=");
    const name = rawName.trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(rawValue.join("=") || "");
  }
  return cookies;
}

function serializeCookie(name, value, { maxAgeSeconds, secure = false, httpOnly = true, sameSite = "Strict", path: cookiePath = "/" } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${cookiePath}`];
  if (httpOnly) parts.push("HttpOnly");
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (Number.isFinite(maxAgeSeconds)) parts.push(`Max-Age=${maxAgeSeconds}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(name, { secure = false, httpOnly = true, sameSite = "Strict", path: cookiePath = "/" } = {}) {
  const parts = [`${name}=`, `Path=${cookiePath}`];
  if (httpOnly) parts.push("HttpOnly");
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  parts.push("Max-Age=0");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
