import path from "node:path";

export function toPosix(value) {
  return value.split(path.sep).join("/");
}

export function makeHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function isInsideRoot(root, filePath) {
  if (!root) return false;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(filePath);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}

export function assertInsideRoot(root, filePath, message = "Requested path is outside the allowed root") {
  if (!isInsideRoot(root, filePath)) {
    throw makeHttpError(message, 403);
  }
  return path.resolve(filePath);
}

export function validateMatterName(rawName) {
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name || name.startsWith(".") || name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw makeHttpError("Invalid matter name", 400);
  }
  return name;
}

export function validateRelativePath(rawPath) {
  const value = typeof rawPath === "string" ? rawPath : "";
  if (!value) throw makeHttpError("Empty file path", 400);
  if (value.startsWith("/") || value.startsWith("\\") || /^[a-zA-Z]:/.test(value)) {
    throw makeHttpError("Absolute paths not allowed", 400);
  }
  const segments = value.split(/[\\/]+/);
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || segment.includes("\0")) {
      throw makeHttpError(`Invalid path segment in ${value}`, 400);
    }
  }
  return segments.join("/");
}

export function resolveRelativeInside(root, relativePath, message = "Resolved path escapes allowed root") {
  const safeRelative = validateRelativePath(relativePath);
  const resolved = path.resolve(root, safeRelative);
  if (!isInsideRoot(root, resolved) || resolved === path.resolve(root)) {
    throw makeHttpError(message, 400);
  }
  return resolved;
}
