import { makeHttpError, validateMatterName } from "./safe-paths.mjs";

export function matterDisplayNameFromCaption(rawName) {
  const caption = typeof rawName === "string" ? rawName.trim() : "";
  if (!caption) throw makeHttpError("Matter name is required", 400, "upload.invalid_matter_name");
  return caption;
}

export function matterStorageNameFromCaption(rawName) {
  const caption = matterDisplayNameFromCaption(rawName);
  const safeName = normalizeReservedStorageName(caption
    .replace(/[\\/]+/g, " - ")
    .replace(/:+/g, " - ")
    .replace(/[?]+/g, "")
    .replace(/[<>"|*]+/g, " ")
    .replace(/\.\.+/g, ".")
    .replace(/[\0\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .replace(/[ .-]+$/g, "")
    .trim());
  if (!safeName || !/[\p{L}\p{N}]/u.test(safeName)) {
    throw makeHttpError("Matter name is required", 400, "upload.invalid_matter_name");
  }
  return validateMatterName(safeName);
}

export function matterStorageCollisionKey(storageName) {
  return String(storageName || "").trim().toLowerCase();
}

export function matterIdentityFromCaption(rawName) {
  const displayName = matterDisplayNameFromCaption(rawName);
  const storageName = matterStorageNameFromCaption(displayName);
  return {
    displayName,
    storageName,
    collisionKey: matterStorageCollisionKey(storageName),
  };
}

export function matterMetadataFields({ metadata = {}, caption = "", storageName = "" } = {}) {
  const matterName = String(metadata.matterName || caption || storageName).trim() || storageName;
  return {
    ...metadata,
    matterName,
  };
}

function normalizeReservedStorageName(name) {
  const match = name.match(/^([^.]*)((?:\..*)?)$/);
  const base = match?.[1] || name;
  const extension = match?.[2] || "";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) {
    return `${base} matter${extension}`;
  }
  return name;
}
