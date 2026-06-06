import path from "node:path";

export const WORKSPACE_PREVIEW_LIMITS = Object.freeze({
  maxPreviewBytes: 512 * 1024,
  maxRawBytes: 50 * 1024 * 1024,
  maxEmailPreviewChars: 80 * 1024,
});

const textPreviewExtensions = new Set([
  ".csv",
  ".json",
  ".log",
  ".md",
  ".mjs",
  ".eml",
  ".txt",
]);

const embeddableExtensions = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".heic",
]);

const rawContentTypes = new Map([
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".heic", "image/heic"],
  [".csv", "text/csv; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".log", "text/plain; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".eml", "message/rfc822; charset=utf-8"],
]);

export function getWorkspaceFileExtension(relativePath = "") {
  return path.extname(String(relativePath || "").replaceAll("\\", "/")).toLowerCase();
}

export function isWorkspaceTextPreviewExtension(relativePath = "") {
  return textPreviewExtensions.has(getWorkspaceFileExtension(relativePath));
}

export function isWorkspaceEmbeddableExtension(relativePath = "") {
  return embeddableExtensions.has(getWorkspaceFileExtension(relativePath));
}

export function getWorkspaceTextPreviewLimit(relativePath = "") {
  return getWorkspaceFileExtension(relativePath) === ".eml"
    ? WORKSPACE_PREVIEW_LIMITS.maxRawBytes
    : WORKSPACE_PREVIEW_LIMITS.maxPreviewBytes;
}

export function classifyWorkspacePreview({
  relativePath = "",
  sizeBytes = 0,
  hasPayload = true,
} = {}) {
  if (!hasPayload) return { previewable: false, previewKind: null };
  const extension = getWorkspaceFileExtension(relativePath);
  const size = Number.isFinite(Number(sizeBytes)) ? Number(sizeBytes) : 0;
  const isText = textPreviewExtensions.has(extension) && size <= getWorkspaceTextPreviewLimit(relativePath);
  const isEmbeddable = embeddableExtensions.has(extension) && size <= WORKSPACE_PREVIEW_LIMITS.maxRawBytes;
  return {
    previewable: isText || isEmbeddable,
    previewKind: isText ? "text" : isEmbeddable ? (extension === ".pdf" ? "pdf" : "image") : null,
  };
}

export function getWorkspaceRawContentType(relativePath = "") {
  return rawContentTypes.get(getWorkspaceFileExtension(relativePath)) || "application/octet-stream";
}
