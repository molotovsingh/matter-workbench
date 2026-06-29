import { USER_FACING_ASSISTANT_UNAVAILABLE_MESSAGE } from "../shared/user-facing-ai-language-policy.js";

export const USER_READINESS_SCHEMA_VERSION = "user-readiness/v1";

const DEFAULT_ASSISTANT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_ASSISTANT_CHECK_TIMEOUT_MS = 8_000;

const CHECK_IDS = Object.freeze({
  SECURE_SESSION: "secure_session",
  WORKSPACE_ACCESS: "workspace_access",
  MATTER_LIBRARY: "matter_library",
  DOCUMENT_SERVICES: "document_services",
  ASSISTANT_READINESS: "assistant_readiness",
});

export function createUserReadinessService({
  aiSettingsService,
  configService,
  matterStore,
  runtimeDbStorageService,
  now = () => new Date(),
  assistantCacheTtlMs = DEFAULT_ASSISTANT_CACHE_TTL_MS,
  assistantCheckTimeoutMs = DEFAULT_ASSISTANT_CHECK_TIMEOUT_MS,
} = {}) {
  let cachedAssistantCheck = null;

  async function readReadiness({ forceAssistantRefresh = false } = {}) {
    const generatedAt = now();
    const checks = [];

    checks.push(readSecureSessionCheck());
    checks.push(readWorkspaceAccessCheck());
    checks.push(await readMatterLibraryCheck());
    checks.push(readDocumentServicesCheck());
    checks.push(await readAssistantReadinessCheck({ forceRefresh: forceAssistantRefresh, generatedAt }));

    const attentionCount = checks.filter((item) => item.status === "attention").length;
    const status = attentionCount ? "degraded" : "ready";
    return {
      schema_version: USER_READINESS_SCHEMA_VERSION,
      generatedAt: generatedAt.toISOString(),
      status,
      summary: {
        total: checks.length,
        ready: checks.length - attentionCount,
        attention: attentionCount,
      },
      checks,
      userMessage: attentionCount
        ? "Some services need attention. You can continue using the workspace."
        : "Workspace ready.",
    };
  }

  return { readReadiness };

  function readSecureSessionCheck() {
    return readyCheck(CHECK_IDS.SECURE_SESSION, "Secure session", "Signed in securely.");
  }

  function readWorkspaceAccessCheck() {
    try {
      const mattersHome = configService?.getMattersHome?.() || "";
      if (usesRuntimeDbStorage()) {
        return readyCheck(CHECK_IDS.WORKSPACE_ACCESS, "Workspace access", "Workspace access is available.");
      }
      if (mattersHome) {
        return readyCheck(CHECK_IDS.WORKSPACE_ACCESS, "Workspace access", "Workspace access is available.");
      }
      return attentionCheck(CHECK_IDS.WORKSPACE_ACCESS, "Workspace access", "Workspace access needs attention before matter work can begin.");
    } catch {
      return attentionCheck(CHECK_IDS.WORKSPACE_ACCESS, "Workspace access", "Workspace access could not be confirmed.");
    }
  }

  async function readMatterLibraryCheck() {
    try {
      if (typeof matterStore?.listMattersHomeChildren !== "function") {
        return attentionCheck(CHECK_IDS.MATTER_LIBRARY, "Matter library", "Matter library could not be checked.");
      }
      const matters = await matterStore.listMattersHomeChildren();
      const count = Array.isArray(matters) ? matters.length : 0;
      return readyCheck(
        CHECK_IDS.MATTER_LIBRARY,
        "Matter library",
        count === 1 ? "1 matter is available." : `${count} matters are available.`,
      );
    } catch {
      return attentionCheck(CHECK_IDS.MATTER_LIBRARY, "Matter library", "Matter library is temporarily unavailable.");
    }
  }

  function readDocumentServicesCheck() {
    try {
      if (usesRuntimeDbStorage()) {
        return readyCheck(CHECK_IDS.DOCUMENT_SERVICES, "Document services", "Document services are ready.");
      }
      const mattersHome = configService?.getMattersHome?.() || "";
      return mattersHome
        ? readyCheck(CHECK_IDS.DOCUMENT_SERVICES, "Document services", "Document services are ready.")
        : attentionCheck(CHECK_IDS.DOCUMENT_SERVICES, "Document services", "Document services need workspace access first.");
    } catch {
      return attentionCheck(CHECK_IDS.DOCUMENT_SERVICES, "Document services", "Document services could not be confirmed.");
    }
  }

  async function readAssistantReadinessCheck({ forceRefresh, generatedAt }) {
    const check = await readCachedOrLiveAssistantCheck({ forceRefresh, generatedAt });
    if (check?.timedOut) {
      return attentionCheck(CHECK_IDS.ASSISTANT_READINESS, "Assistant readiness", "Assistant readiness is taking longer than usual. You can continue using the workspace.");
    }
    if (check?.ok) {
      return readyCheck(CHECK_IDS.ASSISTANT_READINESS, "Assistant readiness", "Assistant is ready.");
    }
    return attentionCheck(CHECK_IDS.ASSISTANT_READINESS, "Assistant readiness", USER_FACING_ASSISTANT_UNAVAILABLE_MESSAGE);
  }

  async function readCachedOrLiveAssistantCheck({ forceRefresh, generatedAt }) {
    if (!forceRefresh && isFreshAssistantCheck(cachedAssistantCheck, generatedAt)) {
      return cachedAssistantCheck;
    }

    const startupCheck = readFreshStartupAssistantCheck(generatedAt);
    if (!forceRefresh && startupCheck) {
      cachedAssistantCheck = startupCheck;
      return startupCheck;
    }

    if (typeof aiSettingsService?.checkCopilotModel !== "function") {
      return { ok: false };
    }

    try {
      const liveCheck = await withTimeout(
        aiSettingsService.checkCopilotModel(),
        assistantCheckTimeoutMs,
      );
      cachedAssistantCheck = {
        ok: Boolean(liveCheck?.ok),
        checkedAt: liveCheck?.checkedAt || generatedAt.toISOString(),
      };
      return cachedAssistantCheck;
    } catch (error) {
      if (error?.code === "readiness.assistant_timeout") {
        return { ok: false, timedOut: true, checkedAt: generatedAt.toISOString() };
      }
      cachedAssistantCheck = { ok: false, checkedAt: generatedAt.toISOString() };
      return cachedAssistantCheck;
    }
  }

  function readFreshStartupAssistantCheck(generatedAt) {
    try {
      const startupCheck = aiSettingsService?.readSettings?.()?.startupChecks?.copilot;
      if (!startupCheck || !isFreshAssistantCheck(startupCheck, generatedAt)) return null;
      return {
        ok: Boolean(startupCheck.ok),
        checkedAt: startupCheck.checkedAt || generatedAt.toISOString(),
      };
    } catch {
      return null;
    }
  }

  function isFreshAssistantCheck(check, generatedAt) {
    if (!check?.checkedAt) return false;
    const ageMs = generatedAt.getTime() - Date.parse(check.checkedAt);
    return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= assistantCacheTtlMs;
  }

  function usesRuntimeDbStorage() {
    return Boolean(matterStore?.hasRuntimeDbStorageMode?.() && runtimeDbStorageService?.enabled);
  }
}

function readyCheck(id, label, message) {
  return { id, label, status: "ready", message };
}

function attentionCheck(id, label, message) {
  return { id, label, status: "attention", message };
}

async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("Assistant readiness check timed out");
          error.code = "readiness.assistant_timeout";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
