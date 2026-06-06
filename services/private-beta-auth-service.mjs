import crypto from "node:crypto";

const SESSION_COOKIE = "mwb_private_beta_session";
const DEFAULT_TTL_SECONDS = 8 * 60 * 60;

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
  const sessions = new Map();

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

  function login({ username: submittedUsername = "", password: submittedPassword = "" } = {}) {
    if (!enabled) {
      return {
        ok: true,
        statusCode: 200,
        payload: status(),
        setCookie: "",
      };
    }

    if (!secureEqual(String(submittedUsername), username) || !secureEqual(String(submittedPassword), password)) {
      return {
        ok: false,
        statusCode: 401,
        payload: { error: "Invalid username or password" },
        setCookie: "",
      };
    }

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
      setCookie: serializeSessionCookie(token, ttlSeconds),
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
      setCookie: clearSessionCookie(),
    };
  }

  function sessionTokenFromRequest(request = {}) {
    return parseCookies(request.headers?.cookie || "")[SESSION_COOKIE] || "";
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

function serializeSessionCookie(token, ttlSeconds) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${ttlSeconds}`,
  ].join("; ");
}

function clearSessionCookie() {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ].join("; ");
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
