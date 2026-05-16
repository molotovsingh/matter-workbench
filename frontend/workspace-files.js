export async function readWorkspaceFile(filePath) {
  const response = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `file API returned ${response.status}`);
  return result;
}

export async function readWorkspaceTextFile(filePath) {
  const result = await readWorkspaceFile(filePath);
  if (typeof result.content !== "string") throw new Error("file preview did not include text content");
  return result.content;
}
