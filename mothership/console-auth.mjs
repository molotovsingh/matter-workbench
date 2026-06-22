import crypto from "node:crypto";

import {
  clearCookie,
  hashPassword,
  hashSessionToken,
  parseCookies,
  parsePasswordHash,
  secureBufferEqual,
  secureEqual,
  serializeCookie,
  shouldUseSecureCookie as shouldUseSecureCookiePrimitive,
  verifyPasswordHash,
} from "../shared/auth-primitives.mjs";
import { createConsoleEmailSender } from "./console-email.mjs";

const DEFAULT_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_LOGIN_MAX_ATTEMPTS = 5;
const DEFAULT_LOGIN_WINDOW_SECONDS = 5 * 60;
const DEFAULT_CODE_TTL_SECONDS = 10 * 60;
const DEFAULT_CODE_SEND_WINDOW_SECONDS = 5 * 60;
const DEFAULT_CODE_VERIFY_MAX_ATTEMPTS = 5;
const SESSION_COOKIE = "mwb_mothership_console_session";
const EMAIL_CODE_GENERIC_MESSAGE = "If this email is allowed, a console code has been sent.";

export function createConsoleAuthService({
  env = process.env,
  now = Date.now,
  tokenBytes = (length) => crypto.randomBytes(length),
  codeGenerator = () => generateNumericCode(),
  emailSender,
  onEmailSendError = () => {},
} = {}) {
  const enabled = isConsoleAuthEnabled(env);
  const authMode = enabled ? consoleAuthMode(env) : "disabled";
  const operatorUsername = enabled ? String(env.MOTHERSHIP_CONSOLE_USERNAME || "").trim() : "";
  const operatorPasswordHash = enabled ? String(env.MOTHERSHIP_CONSOLE_PASSWORD_HASH || "").trim() : "";
  const allowedEmails = enabled && authMode === "email_code" ? parseAllowedEmails(env.MOTHERSHIP_CONSOLE_ALLOWED_EMAILS) : new Set();

  if (enabled && authMode === "password" && (!operatorUsername || !operatorPasswordHash || !parsePasswordHash(operatorPasswordHash))) {
    throw new Error(
      "MOTHERSHIP_CONSOLE_USERNAME and a valid MOTHERSHIP_CONSOLE_PASSWORD_HASH (pbkdf2-sha256$<iterations>$<saltB64url>$<hashB64url>) are required when password console auth is enabled.",
    );
  }
  if (enabled && authMode === "email_code" && allowedEmails.size === 0) {
    throw new Error("MOTHERSHIP_CONSOLE_ALLOWED_EMAILS is required when MOTHERSHIP_CONSOLE_AUTH_MODE=email_code.");
  }
  const resolvedEmailSender = enabled && authMode === "email_code"
    ? (emailSender || createConsoleEmailSender({ env }))
    : null;

  const ttlSeconds = positiveInt(env.MOTHERSHIP_CONSOLE_SESSION_TTL_SECONDS, DEFAULT_TTL_SECONDS);
  const secureCookie = shouldUseSecureCookie(env);
  const loginMaxAttempts = positiveInt(env.MOTHERSHIP_CONSOLE_LOGIN_MAX_ATTEMPTS, DEFAULT_LOGIN_MAX_ATTEMPTS);
  const loginWindowMs = positiveInt(env.MOTHERSHIP_CONSOLE_LOGIN_WINDOW_SECONDS, DEFAULT_LOGIN_WINDOW_SECONDS) * 1000;
  const codeTtlSeconds = positiveInt(env.MOTHERSHIP_CONSOLE_CODE_TTL_SECONDS, DEFAULT_CODE_TTL_SECONDS);
  const codeSendWindowMs = positiveInt(env.MOTHERSHIP_CONSOLE_CODE_SEND_WINDOW_SECONDS, DEFAULT_CODE_SEND_WINDOW_SECONDS) * 1000;
  const codeVerifyMaxAttempts = positiveInt(env.MOTHERSHIP_CONSOLE_CODE_VERIFY_MAX_ATTEMPTS, DEFAULT_CODE_VERIFY_MAX_ATTEMPTS);
  const codePepper = tokenBytes(32).toString("base64url");
  const sessions = new Map();
  const loginFailures = new Map();
  const codeSendRecords = new Map();
  const pendingCodes = new Map();

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
      authMode: enabled ? authMode : "disabled",
      user: enabled && session ? session.user : null,
    };
  }

  function login({ username = "", password = "" } = {}, options = {}) {
    if (!enabled) {
      return { ok: true, statusCode: 200, payload: status(), setCookie: "" };
    }
    if (authMode !== "password") {
      return {
        ok: false,
        statusCode: 400,
        payload: { error: "Use email code sign-in." },
        setCookie: "",
      };
    }
    const clientKey = loginClientKey(options);
    const throttle = throttleState(loginFailures, clientKey, loginWindowMs, loginMaxAttempts, now());
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
      recordFailure(loginFailures, clientKey, loginWindowMs, now());
      return {
        ok: false,
        statusCode: 401,
        payload: { error: "Invalid username or password" },
        setCookie: "",
      };
    }
    loginFailures.delete(clientKey);
    return issueSession({ username: operatorUsername, role: "operator", displayName: "Operator" });
  }

  async function requestCode({ email = "" } = {}, options = {}) {
    if (!enabled) return { ok: true, statusCode: 200, payload: status() };
    if (authMode !== "email_code") {
      return { ok: false, statusCode: 400, payload: { error: "Email code sign-in is not enabled." } };
    }
    const normalizedEmail = normalizeEmail(email);
    const sendKey = `send:${loginClientKey(options)}:${normalizedEmail || "blank"}`;
    const throttle = throttleState(codeSendRecords, sendKey, codeSendWindowMs, 1, now());
    if (throttle.blocked) {
      return { ok: false, statusCode: 429, payload: { error: "Too many code requests. Try again shortly." } };
    }
    const sendThrottleRecord = recordFailure(codeSendRecords, sendKey, codeSendWindowMs, now());

    if (!allowedEmails.has(normalizedEmail)) {
      return { ok: true, statusCode: 200, payload: { ok: true, message: EMAIL_CODE_GENERIC_MESSAGE } };
    }

    const code = String(codeGenerator()).replace(/\D/g, "").slice(0, 6).padStart(6, "0");
    const expiresAt = now() + codeTtlSeconds * 1000;
    const codeHash = hashEmailCode({ email: normalizedEmail, code, pepper: codePepper });
    pendingCodes.set(normalizedEmail, {
      codeHash,
      expiresAt,
      attempts: 0,
    });
    const sendPromise = resolvedEmailSender.sendConsoleCode({
      email: normalizedEmail,
      code,
      expiresInMinutes: Math.max(1, Math.ceil(codeTtlSeconds / 60)),
    });
    Promise.resolve(sendPromise).catch((error) => {
      if (codeSendRecords.get(sendKey) === sendThrottleRecord) codeSendRecords.delete(sendKey);
      const pending = pendingCodes.get(normalizedEmail);
      if (pending?.codeHash === codeHash) pendingCodes.delete(normalizedEmail);
      onEmailSendError(error);
    });
    return { ok: true, statusCode: 200, payload: { ok: true, message: EMAIL_CODE_GENERIC_MESSAGE } };
  }

  function verifyCode({ email = "", code = "" } = {}, options = {}) {
    if (!enabled) return { ok: true, statusCode: 200, payload: status(), setCookie: "" };
    if (authMode !== "email_code") {
      return { ok: false, statusCode: 400, payload: { error: "Email code sign-in is not enabled." }, setCookie: "" };
    }
    const normalizedEmail = normalizeEmail(email);
    const clientKey = `verify:${loginClientKey(options)}:${normalizedEmail || "blank"}`;
    const throttle = throttleState(loginFailures, clientKey, loginWindowMs, loginMaxAttempts, now());
    if (throttle.blocked) {
      return { ok: false, statusCode: 429, payload: { error: "Too many verification attempts. Try again later." }, setCookie: "" };
    }

    const pending = pendingCodes.get(normalizedEmail);
    const cleanCode = String(code || "").replace(/\s+/g, "");
    const codeHash = hashEmailCode({ email: normalizedEmail, code: cleanCode, pepper: codePepper });
    const valid = Boolean(
      allowedEmails.has(normalizedEmail)
      && pending
      && pending.expiresAt > now()
      && pending.attempts < codeVerifyMaxAttempts
      && secureBufferEqual(Buffer.from(codeHash, "hex"), Buffer.from(pending.codeHash, "hex")),
    );

    if (!valid) {
      if (pending) pending.attempts += 1;
      recordFailure(loginFailures, clientKey, loginWindowMs, now());
      return { ok: false, statusCode: 401, payload: { error: "Invalid or expired code" }, setCookie: "" };
    }

    pendingCodes.delete(normalizedEmail);
    loginFailures.delete(clientKey);
    return issueSession({ username: normalizedEmail, role: "operator", displayName: normalizedEmail });
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
      payload: { enabled, authenticated: false, authMode, user: null },
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

  function issueSession(user) {
    const token = newSessionToken(tokenBytes);
    const tokenHash = hashSessionToken(token);
    const session = { user, expiresAt: now() + ttlSeconds * 1000 };
    sessions.set(tokenHash, session);
    return {
      ok: true,
      statusCode: 200,
      payload: { enabled, authenticated: true, authMode, user },
      setCookie: serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: ttlSeconds, secure: secureCookie }),
    };
  }

  return {
    requireAuth,
    status,
    login,
    requestCode,
    verifyCode,
    logout,
    isAuthenticated,
    sessionUser,
    sessionCookieName: SESSION_COOKIE,
    secureCookie,
    authMode,
  };
}

export function hashConsolePassword(password, { iterations = 210_000, saltBytes = 16, hashBytes = 32 } = {}) {
  return hashPassword(password, { iterations, saltBytes, hashBytes });
}

export function verifyPassword(password, encodedHash) {
  return verifyPasswordHash(password, encodedHash);
}

export { parsePasswordHash } from "../shared/auth-primitives.mjs";

export function isConsoleAuthEnabled(env) {
  const mode = String(env.MOTHERSHIP_CONSOLE || env.MOTHERSHIP_CONSOLE_AUTH || "").trim().toLowerCase();
  if (["open", "disabled", "false", "0", "no", "off"].includes(mode)) return false;
  return true;
}

function consoleAuthMode(env) {
  const mode = String(env.MOTHERSHIP_CONSOLE_AUTH_MODE || "password").trim().toLowerCase().replace(/-/g, "_");
  if (["password", "email_code"].includes(mode)) return mode;
  throw new Error(`Unsupported MOTHERSHIP_CONSOLE_AUTH_MODE: ${mode}`);
}

function parseAllowedEmails(value = "") {
  return new Set(String(value || "").split(/[\s,]+/).map(normalizeEmail).filter(Boolean));
}

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function readSessionToken(request = {}) {
  const cookies = parseCookies(request.headers?.cookie || "");
  return String(cookies[SESSION_COOKIE] || "").trim();
}

function newSessionToken(tokenBytes) {
  return `mwb_console_${tokenBytes(32).toString("base64url")}`;
}

function hashEmailCode({ email, code, pepper }) {
  return crypto.createHash("sha256").update(`${pepper}:${email}:${code}`).digest("hex");
}

function generateNumericCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function loginClientKey(options = {}) {
  if (typeof options.clientKey === "string" && options.clientKey.trim()) return options.clientKey.trim();
  const request = options.request || {};
  return String(request.socket?.remoteAddress || "local").trim() || "local";
}

function throttleState(records, clientKey, windowMs, maxAttempts, currentTime) {
  const record = records.get(clientKey);
  if (!record || record.resetAt <= currentTime) return { blocked: false, count: 0 };
  if (record.count >= maxAttempts) return { blocked: true, count: record.count };
  return { blocked: false, count: record.count };
}

function recordFailure(records, clientKey, windowMs, currentTime) {
  const record = records.get(clientKey);
  if (!record || record.resetAt <= currentTime) {
    const next = { count: 1, resetAt: currentTime + windowMs };
    records.set(clientKey, next);
    return next;
  }
  record.count += 1;
  record.resetAt = currentTime + windowMs;
  return record;
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function shouldUseSecureCookie(env) {
  return shouldUseSecureCookiePrimitive(env, {
    explicitVar: "MOTHERSHIP_CONSOLE_COOKIE_SECURE",
    publicUrlVars: ["MOTHERSHIP_CONSOLE_PUBLIC_URL"],
  });
}
