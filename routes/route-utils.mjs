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

function nestedStringValue(item, fieldPath) {
  let current = item;
  for (const segment of String(fieldPath || "").split(".")) {
    if (!segment) return "";
    current = current?.[segment];
  }
  return typeof current === "string" ? current.trim() : "";
}
