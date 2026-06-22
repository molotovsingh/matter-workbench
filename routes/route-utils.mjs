import { currentRequestContext } from "../services/request-context.mjs";

export function usesRuntimeDbStorage(matterStore, runtimeDbStorageService) {
  return Boolean(matterStore?.hasRuntimeDbStorageMode?.() && runtimeDbStorageService?.enabled);
}

export async function safeCaptureBetaSignal(capture) {
  try {
    if (typeof capture === "function") await capture();
  } catch {
    // Diagnostic signal capture must not break the product route that exposed the signal.
  }
}

export function isPrivateBetaScopedUser() {
  const context = currentRequestContext();
  return Boolean(context.authEnabled && context.authenticated && context.user?.role !== "superuser");
}

export function isPrivateBetaSuperuserOrLocal() {
  const context = currentRequestContext();
  return !context.authEnabled || context.user?.role === "superuser";
}

export async function visibleMatterNameSet(matterStore) {
  const matters = typeof matterStore?.listMattersHomeChildren === "function"
    ? await matterStore.listMattersHomeChildren()
    : [];
  const names = new Set();
  for (const matter of Array.isArray(matters) ? matters : []) {
    for (const field of ["name", "matterName", "folderName"]) {
      const value = typeof matter?.[field] === "string" ? matter[field].trim() : "";
      if (value) names.add(value);
    }
  }
  return names;
}

export function filterByVisibleMatterNames(items, visibleNames, {
  fields = ["matterName", "matterFolder", "context.activeMatterName", "context.activeMatterFolder"],
} = {}) {
  if (!Array.isArray(items) || !(visibleNames instanceof Set) || visibleNames.size === 0) return [];
  return items.filter((item) => {
    for (const field of fields) {
      const value = nestedStringValue(item, field);
      if (value && visibleNames.has(value)) return true;
    }
    return false;
  });
}

export async function runtimeDbMatterForQuery(matterStore, requestUrl, { allowMissingActive = false } = {}) {
  const matterName = requestUrl.searchParams.get("matter")?.trim() || "";
  if (matterName) return matterStore.resolveExistingMatter(matterName);
  const activeMatter = matterStore.getActiveMatterRecord?.();
  if (activeMatter) return activeMatter;
  if (allowMissingActive) {
    matterStore.getMatterRoot?.();
  } else {
    matterStore.ensureMatterRoot();
  }
  return matterStore.getActiveMatterRecord?.();
}

export async function matterRootForQuery(matterStore, requestUrl, { allowMissingActive = false } = {}) {
  const matterName = requestUrl.searchParams.get("matter")?.trim() || "";
  if (!matterName) {
    if (allowMissingActive) return matterStore.getMatterRoot?.() || null;
    return matterStore.ensureMatterRoot();
  }
  const { matterPath } = await matterStore.resolveExistingMatter(matterName);
  return matterPath;
}

export async function runtimeDbMatterForBody(matterStore, body = {}) {
  const matterName = typeof body.matterName === "string" ? body.matterName.trim() : "";
  if (matterName) return matterStore.resolveExistingMatter(matterName);
  const activeMatter = matterStore.getActiveMatterRecord?.();
  if (activeMatter) return activeMatter;
  matterStore.ensureMatterRoot();
  return matterStore.getActiveMatterRecord?.();
}

export async function matterRootForBody(matterStore, body = {}) {
  const matterName = typeof body.matterName === "string" ? body.matterName.trim() : "";
  if (!matterName) return matterStore.ensureMatterRoot();
  const { matterPath } = await matterStore.resolveExistingMatter(matterName);
  return matterPath;
}

function nestedStringValue(item, fieldPath) {
  let current = item;
  for (const segment of String(fieldPath || "").split(".")) {
    if (!segment) return "";
    current = current?.[segment];
  }
  return typeof current === "string" ? current.trim() : "";
}
