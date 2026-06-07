import crypto from "node:crypto";

const SESSION_COOKIE = "mwb_private_beta_session";
const DEFAULT_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_LOGIN_MAX_ATTEMPTS = 5;
const DEFAULT_LOGIN_WINDOW_SECONDS = 5 * 60;

export function createPrivateBetaAuthService({
  env = process.env,
  now = Date.now,
  tokenBytes = (length) => crypto.randomBytes(length),
} = {}) {
  const mode = String(env.MWB_PRIVATE_BETA_AUTH || "").trim().toLowerCase();
  const enabled = ["required", "true", "1", "yes", "on"].includes(mode);
  const username = String(env.MWB_PRIVATE_BETA_USERNAME || "").trim();
  const password = String(env.MWB_PRIVATE_BETA_PASSWORD || "");
  const ttlSeconds = positiveInt(env.MWB_PRIVATE_BETA_SESSION_TTL_SECONDS, DEFAULT_TTL_SECONDS);
  const secureCookie = shouldUseSecureCookie(env);
  const loginMaxAttempts = positiveInt(env.MWB_PRIVATE_BETA_LOGIN_MAX_ATTEMPTS, DEFAULT_LOGIN_MAX_ATTEMPTS);
  const loginWindowMs = positiveInt(env.MWB_PRIVATE_BETA_LOGIN_WINDOW_SECONDS, DEFAULT_LOGIN_WINDOW_SECONDS) * 1000;
  const sessions = new Map();
  const loginFailures = new Map();

  if (enabled && (!username || !password)) {
    throw new Error("MWB_PRIVATE_BETA_USERNAME and MWB_PRIVATE_BETA_PASSWORD are required when MWB_PRIVATE_BETA_AUTH=required.");
  }

  function requireAuth() {
    return enabled;
  }

  function isAuthenticated(request = {}) {
    if (!enabled) return true;
    const token = sessionTokenFromRequest(request);
    if (!token) return false;
    const session = sessions.get(token);
    if (!session) return false;
    if (session.expiresAt <= now()) {
      sessions.delete(token);
      return false;
    }
    return true;
  }

  function status(request = {}) {
    const authenticated = isAuthenticated(request);
    return {
      enabled,
      authenticated,
      user: enabled && authenticated ? { username } : null,
    };
  }

  function login({ username: submittedUsername = "", password: submittedPassword = "" } = {}, options = {}) {
    if (!enabled) {
      return {
        ok: true,
        statusCode: 200,
        payload: status(),
        setCookie: "",
      };
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

    if (!secureEqual(String(submittedUsername), username) || !secureEqual(String(submittedPassword), password)) {
      recordFailedLogin(clientKey);
      return {
        ok: false,
        statusCode: 401,
        payload: { error: "Invalid username or password" },
        setCookie: "",
      };
    }

    loginFailures.delete(clientKey);
    const token = tokenBytes(32).toString("hex");
    sessions.set(token, {
      username,
      expiresAt: now() + ttlSeconds * 1000,
    });
    return {
      ok: true,
      statusCode: 200,
      payload: {
        enabled: true,
        authenticated: true,
        user: { username },
      },
      setCookie: serializeSessionCookie(token, ttlSeconds, { secure: secureCookie }),
    };
  }

  function logout(request = {}) {
    const token = sessionTokenFromRequest(request);
    if (token) sessions.delete(token);
    return {
      ok: true,
      statusCode: 200,
      payload: {
        enabled,
        authenticated: false,
        user: null,
      },
      setCookie: clearSessionCookie({ secure: secureCookie }),
    };
  }

  function sessionTokenFromRequest(request = {}) {
    return parseCookies(request.headers?.cookie || "")[SESSION_COOKIE] || "";
  }

  function throttleState(clientKey) {
    const currentTime = now();
    const record = throttleStateForRecord(loginFailures.get(clientKey), currentTime);
    if (!record.count) loginFailures.delete(clientKey);
    return {
      blocked: record.count >= loginMaxAttempts,
    };
  }

  function recordFailedLogin(clientKey) {
    const currentTime = now();
    const existing = throttleStateForRecord(loginFailures.get(clientKey), currentTime);
    loginFailures.set(clientKey, {
      count: existing.count + 1,
      resetAt: existing.resetAt > currentTime ? existing.resetAt : currentTime + loginWindowMs,
    });
  }

  return {
    enabled,
    requireAuth,
    isAuthenticated,
    status,
    login,
    logout,
    cookieName: SESSION_COOKIE,
  };
}

export function parseCookies(cookieHeader = "") {
  const cookies = {};
  for (const part of String(cookieHeader || "").split(";")) {
    const [rawName, ...rawValue] = part.split("=");
    const name = rawName.trim();
    if (!name) continue;
    const value = rawValue.join("=");
    cookies[name] = decodeURIComponent(value || "");
  }
  return cookies;
}

function serializeSessionCookie(token, ttlSeconds, { secure = false } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${ttlSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function clearSessionCookie({ secure = false } = {}) {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
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

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function shouldUseSecureCookie(env = {}) {
  const explicit = String(env.MWB_PRIVATE_BETA_COOKIE_SECURE || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(explicit)) return true;
  if (["0", "false", "no", "off"].includes(explicit)) return false;
  const publicUrl = String(env.MWB_PRIVATE_BETA_PUBLIC_URL || env.MWB_PUBLIC_URL || "").trim();
  return /^https:\/\//i.test(publicUrl);
}

function loginClientKey(options = {}) {
  if (typeof options.clientKey === "string" && options.clientKey.trim()) return options.clientKey.trim();
  const request = options.request || {};
  const forwarded = String(request.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  if (forwarded) return forwarded;
  return String(request.socket?.remoteAddress || "local").trim() || "local";
}

function throttleStateForRecord(record, currentTime) {
  if (!record || record.resetAt <= currentTime) return { count: 0, resetAt: currentTime };
  return record;
}
