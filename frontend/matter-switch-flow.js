export async function switchMatterFlow({
  name,
  postSwitchMatter,
  mergeMattersState,
  clearMatterSearch,
  setActiveMatter,
  matterFromWorkspace,
  resetForMatterChange,
} = {}) {
  if (!name) return null;
  const payload = await postSwitchMatter(name);
  mergeMattersState({ active: name });
  clearMatterSearch?.("");
  resetForMatterChange?.();
  setActiveMatter(matterFromWorkspace(payload));
  return payload;
}
