import path from "node:path";

export async function readMatterSummary(matterStore, { matterName } = {}) {
  const requestedMatterName = String(matterName || "").trim();
  if (!requestedMatterName) return readActiveMatterSummary(matterStore);

  try {
    const resolved = await matterStore.resolveExistingMatter(requestedMatterName);
    const { matterPath } = resolved;
    const folderName = resolved.runtimeStorageMode === "postgres"
      ? String(resolved.name || resolved.folderName || requestedMatterName).trim()
      : path.basename(matterPath);
    let metadata = {};
    try {
      metadata = await matterStore.readMatterMetadata(matterPath);
    } catch {
      metadata = {};
    }
    return {
      folderName,
      matterName: metadata.matterName || folderName,
    };
  } catch {
    return {
      folderName: requestedMatterName,
      matterName: requestedMatterName,
    };
  }
}

export async function readActiveMatterSummary(matterStore) {
  const root = matterStore.getMatterRoot?.();
  if (!root) return null;
  const folderName = matterStore.activeMatterNameWithinHome?.() || path.basename(root);
  let metadata = {};
  try {
    metadata = await matterStore.readMatterMetadata(root);
  } catch {
    metadata = {};
  }
  return {
    folderName,
    matterName: metadata.matterName || folderName,
  };
}
