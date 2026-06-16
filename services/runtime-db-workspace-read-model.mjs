import { classifyWorkspacePreview } from "../shared/workspace-preview-policy.mjs";
import { validatedRelativePathFromRuntimeObjectKey } from "./runtime-db-object-key-policy.mjs";

export function buildRuntimeWorkspaceTree({ matter, objects }) {
  const root = {
    name: matter.name,
    kind: "directory",
    path: "",
    children: [],
  };
  let fileCount = 0;
  const directoryPaths = new Set();

  for (const object of objects) {
    const relativePath = validatedRelativePathFromRuntimeObjectKey(object.objectKey, matter.name);
    if (!relativePath) continue;
    const pathParts = relativePath.split("/").filter(Boolean);
    if (!pathParts.length) continue;
    let cursor = root;
    let cursorPath = "";
    for (let index = 0; index < pathParts.length; index += 1) {
      const name = pathParts[index];
      const isFile = index === pathParts.length - 1;
      cursorPath = cursorPath ? `${cursorPath}/${name}` : name;
      if (!isFile) {
        directoryPaths.add(cursorPath);
        let directory = cursor.children.find((child) => child.kind === "directory" && child.name === name);
        if (!directory) {
          directory = { name, kind: "directory", path: cursorPath, children: [] };
          cursor.children.push(directory);
        }
        cursor = directory;
        continue;
      }
      const size = object.sizeBytes || 0;
      const preview = classifyWorkspacePreview({
        relativePath: cursorPath,
        sizeBytes: size,
        hasPayload: Boolean(object.hasPayload),
      });
      cursor.children.push({
        name,
        kind: "file",
        path: cursorPath,
        size,
        previewable: preview.previewable,
        previewKind: preview.previewKind,
        objectRole: object.objectRole,
        sha256: object.sha256,
        updatedAt: object.updatedAt,
        fileId: object.fileId,
        originalName: object.originalName,
        documentSha: object.documentSha,
        documentSizeBytes: object.documentSizeBytes,
        duplicateOf: object.duplicateOf,
      });
      fileCount += 1;
    }
  }

  sortRuntimeWorkspaceTree(root);
  return {
    root,
    fileCount,
    directoryCount: directoryPaths.size,
  };
}

export function publicRuntimeWorkspaceTree(node) {
  if (!node || typeof node !== "object") return node;
  if (node.kind === "file") {
    return {
      name: node.name,
      kind: "file",
      path: node.path,
      size: node.size || 0,
      previewable: Boolean(node.previewable),
      previewKind: node.previewKind || "none",
    };
  }
  return {
    name: node.name,
    kind: "directory",
    path: node.path,
    children: (node.children || []).map(publicRuntimeWorkspaceTree),
  };
}

export function normalizeRuntimeWorkspaceObjectRow(row = {}) {
  return {
    objectKey: stringValue(row.objectKey || row.object_key),
    objectRole: stringValue(row.objectRole || row.object_role),
    mimeType: stringValue(row.mimeType || row.mime_type),
    sizeBytes: Number(row.sizeBytes || row.size_bytes) || 0,
    sha256: stringValue(row.sha256),
    updatedAt: normalizeIsoString(row.updatedAt || row.updated_at),
    hasPayload: Boolean(row.hasPayload ?? row.has_payload),
    fileId: stringValue(row.fileId || row.file_id),
    originalName: stringValue(row.originalName || row.original_name),
    documentSha: stringValue(row.documentSha || row.document_sha),
    documentSizeBytes: Number(row.documentSizeBytes || row.document_size_bytes) || 0,
    duplicateOf: stringValue(row.duplicateOf || row.duplicate_of),
  };
}

function sortRuntimeWorkspaceTree(node) {
  if (!Array.isArray(node.children)) return;
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortRuntimeWorkspaceTree(child);
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIsoString(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}
