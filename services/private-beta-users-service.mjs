import crypto from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { hashPrivateBetaPassword, readPrivateBetaUsersFile } from "./private-beta-auth-service.mjs";
import { writeFileAtomic } from "../shared/atomic-file.mjs";

const SCHEMA_VERSION = "private-beta-users/v1";

export function createPrivateBetaUsersService({
  usersFile = "",
  now = () => new Date().toISOString(),
  generatePassword = defaultTemporaryPassword,
} = {}) {
  const storePath = expandHomePath(usersFile);

  async function listUsers() {
    const store = await readStore();
    return {
      schema_version: "private-beta-users-list/v1",
      users: store.users.map(publicUser),
    };
  }

  async function addTester({ username = "", displayName = "" } = {}) {
    const normalizedUsername = normalizeUsername(username);
    const store = await readStore();
    if (findUser(store, normalizedUsername)) {
      throw statusError(`Private beta account already exists: ${normalizedUsername}`, 409);
    }
    const temporaryPassword = generatePassword();
    const timestamp = now();
    const user = {
      username: normalizedUsername,
      displayName: String(displayName || "").trim(),
      role: "tester",
      disabled: false,
      passwordHash: hashPrivateBetaPassword(temporaryPassword),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.users.push(user);
    await writeStore(store);
    return userResponse(publicUser(user), temporaryPassword);
  }

  async function resetPassword(username = "") {
    const store = await readStore();
    const user = requireUser(store, username);
    const temporaryPassword = generatePassword();
    user.passwordHash = hashPrivateBetaPassword(temporaryPassword);
    user.updatedAt = now();
    await writeStore(store);
    return userResponse(publicUser(user), temporaryPassword);
  }

  async function setUserDisabled(username = "", disabled = true) {
    const store = await readStore();
    const user = requireUser(store, username);
    if (disabled && user.role === "superuser" && activeSuperuserCount(store) <= 1) {
      throw statusError("Cannot disable the last active superuser.", 409);
    }
    user.disabled = Boolean(disabled);
    user.updatedAt = now();
    await writeStore(store);
    return userResponse(publicUser(user));
  }

  async function readStore() {
    if (!storePath) throw statusError("MWB_PRIVATE_BETA_USERS_FILE is not configured.", 409);
    let rawText;
    try {
      rawText = await readFile(storePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { schemaVersion: SCHEMA_VERSION, users: [] };
      throw error;
    }
    const validatedUsers = readPrivateBetaUsersFile(storePath);
    const raw = JSON.parse(rawText);
    return {
      schemaVersion: SCHEMA_VERSION,
      users: raw.users.map((user, index) => ({
        ...user,
        username: validatedUsers[index].username,
        displayName: validatedUsers[index].displayName,
        role: validatedUsers[index].role,
        disabled: validatedUsers[index].disabled,
        passwordHash: validatedUsers[index].passwordHash,
      })),
    };
  }

  async function writeStore(store) {
    if (!storePath) throw statusError("MWB_PRIVATE_BETA_USERS_FILE is not configured.", 409);
    await mkdir(path.dirname(storePath), { recursive: true });
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      users: store.users
        .map((user) => ({
          username: normalizeUsername(user.username),
          displayName: String(user.displayName || "").trim(),
          role: normalizeRole(user.role),
          disabled: Boolean(user.disabled),
          passwordHash: String(user.passwordHash || ""),
          createdAt: String(user.createdAt || ""),
          updatedAt: String(user.updatedAt || ""),
        }))
        .sort((left, right) => left.username.localeCompare(right.username)),
    };
    // The store contains password hashes, so keep it unreadable to other local accounts.
    await writeFileAtomic(storePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  return {
    listUsers,
    addTester,
    resetPassword,
    setUserDisabled,
  };
}

function userResponse(user, temporaryPassword = undefined) {
  return {
    schema_version: "private-beta-user-response/v1",
    user,
    ...(temporaryPassword ? { temporaryPassword } : {}),
  };
}

function publicUser(user) {
  return {
    username: user.username,
    displayName: String(user.displayName || "").trim(),
    role: normalizeRole(user.role),
    disabled: Boolean(user.disabled),
    createdAt: String(user.createdAt || ""),
    updatedAt: String(user.updatedAt || ""),
  };
}

function requireUser(store, username) {
  const user = findUser(store, normalizeUsername(username));
  if (!user) throw statusError(`No private beta account found for ${username}.`, 404);
  return user;
}

function findUser(store, username) {
  const key = normalizeUsername(username).toLowerCase();
  return store.users.find((user) => String(user.username || "").trim().toLowerCase() === key) || null;
}

function activeSuperuserCount(store) {
  return store.users.filter((user) => normalizeRole(user.role) === "superuser" && !user.disabled).length;
}

function normalizeUsername(username) {
  const value = String(username || "").trim();
  if (!value) throw statusError("Username is required.", 400);
  if (!/^[A-Za-z0-9._@-]{2,80}$/.test(value)) {
    throw statusError("Username may use letters, numbers, dot, underscore, dash, or @, and must be 2-80 characters.", 400);
  }
  return value;
}

function normalizeRole(role) {
  const normalized = String(role || "tester").trim().toLowerCase();
  if (["superuser", "operator", "tester"].includes(normalized)) return normalized;
  return "tester";
}

function statusError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function defaultTemporaryPassword() {
  return crypto.randomBytes(18).toString("base64url");
}

function expandHomePath(filePath) {
  const value = String(filePath || "").trim();
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}
