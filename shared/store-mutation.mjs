export function isStoreReplacement(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.skills));
}
