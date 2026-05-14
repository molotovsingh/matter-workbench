import path from "node:path";

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
