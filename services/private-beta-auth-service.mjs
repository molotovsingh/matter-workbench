import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SESSION_COOKIE = "mwb_private_beta_session";
const DEFAULT_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_LOGIN_MAX_ATTEMPTS = 5;
const DEFAULT_LOGIN_WINDOW_SECONDS = 5 * 60;
const PRIVATE_BETA_USERS_SCHEMA_VERSION = "private-beta-users/v1";
const PRIVATE_BETA_SESSIONS_SCHEMA_VERSION = "private-beta-sessions/v1";
const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
const DEFAULT_PASSWORD_HASH_ITERATIONS = 210_000;
const PASSWORD_HASH_BYTES = 32;
const DUMMY_PRIVATE_BETA_PASSWORD_HASH = makeDummyPrivateBetaPasswordHash();

export function createPrivateBetaAuthService({
  env = process.env,
  now = Date.now,
  tokenBytes = (length) => crypto.randomBytes(length),
} = {}) {
  const mode = String(env.MWB_PRIVATE_BETA_AUTH || "").trim().toLowerCase();
  const enabled = ["required", "true", "1", "yes", "on"].includes(mode);
  const credentialSource = enabled ? loadPrivateBetaCredentialSource(env) : null;
  const ttlSeconds = positiveInt(env.MWB_PRIVATE_BETA_SESSION_TTL_SECONDS, DEFAULT_TTL_SECONDS);
  const secureCookie = shouldUseSecureCookie(env);
  const loginMaxAttempts = positiveInt(env.MWB_PRIVATE_BETA_LOGIN_MAX_ATTEMPTS, DEFAULT_LOGIN_MAX_ATTEMPTS);
  const loginWindowMs = positiveInt(env.MWB_PRIVATE_BETA_LOGIN_WINDOW_SECONDS, DEFAULT_LOGIN_WINDOW_SECONDS) * 1000;
  const sessionsFile = enabled ? resolvePrivateBetaSessionsFile(env) : "";
  const sessions = enabled ? readPrivateBetaSessionsFile(sessionsFile, now()) : new Map();
  const loginFailures = new Map();

  function requireAuth() {
    return enabled;
  }

  function isAuthenticated(request = {}) {
    return Boolean(sessionFromRequest(request));
  }

  function sessionFromRequest(request = {}) {
    if (!enabled) return true;
    const token = sessionTokenFromRequest(request);
    if (!token) return null;
    const tokenHash = hashSessionToken(token);
    const session = sessions.get(tokenHash);
    if (!session) return null;
    if (session.expiresAt <= now()) {
      sessions.delete(tokenHash);
      persistSessionsBestEffort();
      return null;
    }
    try {
      const refreshedUser = credentialSource.refreshSessionUser(session.user);
      if (!refreshedUser) {
        sessions.delete(tokenHash);
        persistSessionsBestEffort();
        return null;
      }
      session.user = refreshedUser;
    } catch {
      sessions.delete(tokenHash);
      persistSessionsBestEffort();
      return null;
    }
    return session;
  }

  function status(request = {}) {
    const session = sessionFromRequest(request);
    const authenticated = !enabled || Boolean(session);
    return {
      enabled,
      authenticated,
      user: enabled && session ? session.user : null,
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

    let account;
    try {
      account = credentialSource.authenticate(String(submittedUsername), String(submittedPassword));
    } catch {
      return {
        ok: false,
        statusCode: 503,
        payload: { error: "Private beta account file is not usable. Ask the operator to check the tester account file." },
        setCookie: "",
      };
    }
    if (!account) {
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
    const tokenHash = hashSessionToken(token);
    const user = publicUserForAccount(account);
    sessions.set(tokenHash, {
      user,
      expiresAt: now() + ttlSeconds * 1000,
    });
    try {
      persistSessions();
    } catch {
      sessions.delete(tokenHash);
      return {
        ok: false,
        statusCode: 503,
        payload: { error: "Private beta session store is not writable. Ask the operator to check the server session file." },
        setCookie: "",
      };
    }
    return {
      ok: true,
      statusCode: 200,
      payload: {
        enabled: true,
        authenticated: true,
        user,
      },
      setCookie: serializeSessionCookie(token, ttlSeconds, { secure: secureCookie }),
    };
  }

  function logout(request = {}) {
    const token = sessionTokenFromRequest(request);
    if (token) {
      sessions.delete(hashSessionToken(token));
      persistSessionsBestEffort();
    }
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

  function persistSessions() {
    if (!enabled || !sessionsFile) return;
    writePrivateBetaSessionsFile(sessionsFile, sessions, now());
  }

  function persistSessionsBestEffort() {
    try {
      persistSessions();
    } catch {
      // A stale session should fail closed even if cleanup cannot be persisted.
    }
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

export function hashPrivateBetaPassword(password, {
  salt = crypto.randomBytes(16),
  iterations = DEFAULT_PASSWORD_HASH_ITERATIONS,
} = {}) {
  const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt));
  const iterationCount = positiveInt(iterations, DEFAULT_PASSWORD_HASH_ITERATIONS);
  const hash = crypto.pbkdf2Sync(String(password), saltBuffer, iterationCount, PASSWORD_HASH_BYTES, "sha256");
  return [
    PASSWORD_HASH_ALGORITHM,
    String(iterationCount),
    saltBuffer.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

export function verifyPrivateBetaPassword(password, encodedHash) {
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

export function readPrivateBetaUsersFile(usersFile) {
  const expandedPath = expandHomePath(usersFile);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(expandedPath, "utf8"));
  } catch (error) {
    throw new Error(`MWB_PRIVATE_BETA_USERS_FILE could not be read as valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MWB_PRIVATE_BETA_USERS_FILE must contain an object.");
  }
  if (parsed.schemaVersion !== PRIVATE_BETA_USERS_SCHEMA_VERSION) {
    throw new Error(`MWB_PRIVATE_BETA_USERS_FILE must use schemaVersion ${PRIVATE_BETA_USERS_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(parsed.users)) {
    throw new Error("MWB_PRIVATE_BETA_USERS_FILE must contain a users array.");
  }
  const seen = new Set();
  const users = parsed.users.map((rawUser, index) => normalizePrivateBetaUser(rawUser, index));
  for (const user of users) {
    const key = user.username.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`MWB_PRIVATE_BETA_USERS_FILE contains duplicate username: ${user.username}`);
    }
    seen.add(key);
  }
  return users;
}

function readPrivateBetaSessionsFile(sessionsFile, currentTime) {
  const sessions = new Map();
  if (!sessionsFile || !fs.existsSync(sessionsFile)) return sessions;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(sessionsFile, "utf8"));
  } catch {
    return sessions;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return sessions;
  if (parsed.schemaVersion !== PRIVATE_BETA_SESSIONS_SCHEMA_VERSION) return sessions;
  if (!Array.isArray(parsed.sessions)) return sessions;
  for (const rawSession of parsed.sessions) {
    const session = normalizePrivateBetaSession(rawSession);
    if (!session || session.expiresAt <= currentTime) continue;
    sessions.set(session.tokenHash, {
      user: session.user,
      expiresAt: session.expiresAt,
    });
  }
  return sessions;
}

function writePrivateBetaSessionsFile(sessionsFile, sessions, currentTime) {
  const rows = [];
  for (const [tokenHash, session] of sessions.entries()) {
    if (!session || session.expiresAt <= currentTime) {
      sessions.delete(tokenHash);
      continue;
    }
    const user = normalizeSessionUser(session.user);
    if (!user) {
      sessions.delete(tokenHash);
      continue;
    }
    rows.push({
      tokenHash,
      user,
      expiresAt: session.expiresAt,
    });
  }
  const payload = `${JSON.stringify({
    schemaVersion: PRIVATE_BETA_SESSIONS_SCHEMA_VERSION,
    sessions: rows,
  }, null, 2)}\n`;
  writeFileAtomicSync(sessionsFile, payload);
}

function normalizePrivateBetaSession(rawSession) {
  if (!rawSession || typeof rawSession !== "object" || Array.isArray(rawSession)) return null;
  const tokenHash = String(rawSession.tokenHash || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(tokenHash)) return null;
  const expiresAt = Number(rawSession.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return null;
  const user = normalizeSessionUser(rawSession.user);
  if (!user) return null;
  return {
    tokenHash: tokenHash.toLowerCase(),
    user,
    expiresAt,
  };
}

function normalizeSessionUser(rawUser) {
  if (!rawUser || typeof rawUser !== "object" || Array.isArray(rawUser)) return null;
  const username = String(rawUser.username || "").trim();
  if (!username) return null;
  const user = { username };
  const rawRole = String(rawUser.role || "").trim();
  if (rawRole) user.role = normalizeRole(rawRole);
  const displayName = String(rawUser.displayName || "").trim();
  if (displayName) user.displayName = displayName;
  return user;
}

function loadPrivateBetaCredentialSource(env) {
  const usersFile = String(env.MWB_PRIVATE_BETA_USERS_FILE || "").trim();
  if (usersFile) {
    readPrivateBetaUsersFile(usersFile);
    return {
      kind: "file",
      authenticate(username, password) {
        const accounts = readPrivateBetaUsersFile(usersFile);
        const account = accounts.find((candidate) => secureEqual(candidate.username, username));
        const fallbackHash = accounts.find((candidate) => candidate.passwordHash)?.passwordHash || DUMMY_PRIVATE_BETA_PASSWORD_HASH;
        const passwordOk = verifyPrivateBetaPassword(password, account?.passwordHash || fallbackHash);
        if (!account || account.disabled || !passwordOk) return null;
        return account;
      },
      refreshSessionUser(user) {
        const account = readPrivateBetaUsersFile(usersFile)
          .find((candidate) => secureEqual(candidate.username, user?.username || ""));
        if (!account || account.disabled) return null;
        return publicUserForAccount(account);
      },
    };
  }

  const username = String(env.MWB_PRIVATE_BETA_USERNAME || "").trim();
  const password = String(env.MWB_PRIVATE_BETA_PASSWORD || "");
  if (!username || !password) {
    throw new Error(
      "MWB_PRIVATE_BETA_USERNAME and MWB_PRIVATE_BETA_PASSWORD are required when MWB_PRIVATE_BETA_AUTH=required, unless MWB_PRIVATE_BETA_USERS_FILE is configured.",
    );
  }
  return {
    kind: "legacy-env",
    authenticate(submittedUsername, submittedPassword) {
      const usernameMatch = secureEqual(String(submittedUsername), username);
      const passwordMatch = secureEqual(String(submittedPassword), password);
      if (!usernameMatch || !passwordMatch) return null;
      return { username, role: null };
    },
    refreshSessionUser(user) {
      if (!secureEqual(String(user?.username || ""), username)) return null;
      return { username };
    },
  };
}

function normalizePrivateBetaUser(rawUser, index) {
  if (!rawUser || typeof rawUser !== "object" || Array.isArray(rawUser)) {
    throw new Error(`MWB_PRIVATE_BETA_USERS_FILE user at index ${index} must be an object.`);
  }
  const username = String(rawUser.username || "").trim();
  const passwordHash = String(rawUser.passwordHash || "").trim();
  if (!username) throw new Error(`MWB_PRIVATE_BETA_USERS_FILE user at index ${index} is missing username.`);
  if (!passwordHash) throw new Error(`MWB_PRIVATE_BETA_USERS_FILE user ${username} is missing passwordHash.`);
  if (!parsePasswordHash(passwordHash)) {
    throw new Error(`MWB_PRIVATE_BETA_USERS_FILE user ${username} has an invalid passwordHash.`);
  }
  return {
    username,
    displayName: String(rawUser.displayName || "").trim(),
    role: normalizeRole(rawUser.role),
    disabled: Boolean(rawUser.disabled),
    passwordHash,
  };
}

function normalizeRole(role) {
  const normalized = String(role || "tester").trim().toLowerCase();
  if (["superuser", "operator", "tester"].includes(normalized)) return normalized;
  return "tester";
}

function publicUserForAccount(account) {
  const user = { username: account.username };
  if (account.role) user.role = account.role;
  if (account.displayName) user.displayName = account.displayName;
  return user;
}

function parsePasswordHash(encodedHash) {
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

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function resolvePrivateBetaSessionsFile(env = {}) {
  const explicit = String(env.MWB_PRIVATE_BETA_SESSIONS_FILE || "").trim();
  if (explicit) return expandHomePath(explicit);
  const usersFile = String(env.MWB_PRIVATE_BETA_USERS_FILE || "").trim();
  if (usersFile) {
    return path.join(path.dirname(expandHomePath(usersFile)), "private-beta-sessions.json");
  }
  return path.join(os.homedir(), ".config", "matter-workbench", "private-beta-sessions.json");
}

function writeFileAtomicSync(filePath, contents) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tempPath, contents, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Preserve the original write/rename error.
    }
    throw error;
  }
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
  return String(request.socket?.remoteAddress || "local").trim() || "local";
}

function makeDummyPrivateBetaPasswordHash() {
  return hashPrivateBetaPassword("mwb-private-beta-dummy-password", {
    salt: "mwb-private-beta-dummy-salt",
    iterations: DEFAULT_PASSWORD_HASH_ITERATIONS,
  });
}

function expandHomePath(filePath) {
  const value = String(filePath || "").trim();
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function throttleStateForRecord(record, currentTime) {
  if (!record || record.resetAt <= currentTime) return { count: 0, resetAt: currentTime };
  return record;
}
