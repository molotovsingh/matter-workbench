export function formatConfigurableRunOutputDocumentState(overwrite) {
  if (overwrite === "approved") return "Replaced existing matter output";
  if (overwrite === "cancelled") return "Kept existing matter output";
  if (overwrite === "prompted") return "Replacement confirmation shown";
  return "Created new matter output";
}
