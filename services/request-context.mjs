import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

const requestContextStorage = new AsyncLocalStorage();

export function runWithRequestContext(context = {}, operation) {
  if (typeof operation !== "function") throw new Error("operation is required");
  return requestContextStorage.run(normalizeRequestContext(context), operation);
}

export function currentRequestContext() {
  return requestContextStorage.getStore() || {};
}

export function requestContextFromAuthStatus(status = {}) {
  return normalizeRequestContext({
    authEnabled: Boolean(status.enabled),
    authenticated: Boolean(status.authenticated),
    user: status.user || null,
  });
}

export function runtimeDbUserFromRequestContext(context = currentRequestContext()) {
  if (!context?.authenticated || !context.user?.username) return null;
  const username = String(context.user.username || "").trim();
  if (!username) return null;
  const normalizedUsername = username.toLowerCase();
  return {
    id: deterministicUuid(`private-beta-user:${normalizedUsername}`),
    username,
    email: normalizedUsername.includes("@") ? normalizedUsername : `${normalizedUsername}@local.private-beta`,
    displayName: String(context.user.displayName || username).trim() || username,
    role: normalizeRole(context.user.role),
  };
}

function normalizeRequestContext(context = {}) {
  const user = context.user && typeof context.user === "object"
    ? {
        username: String(context.user.username || "").trim(),
        role: normalizeRole(context.user.role),
        displayName: String(context.user.displayName || "").trim(),
      }
    : null;
  return {
    authEnabled: Boolean(context.authEnabled),
    authenticated: Boolean(context.authenticated),
    user: user?.username ? user : null,
  };
}

function normalizeRole(role) {
  const normalized = String(role || "tester").trim().toLowerCase();
  if (["superuser", "operator", "tester"].includes(normalized)) return normalized;
  return "tester";
}

function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
