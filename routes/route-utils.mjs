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
