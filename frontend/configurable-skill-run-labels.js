export function formatConfigurableRunOutputDocumentState(overwrite) {
  if (overwrite === "approved") return "Replaced existing output document";
  if (overwrite === "cancelled") return "Kept existing output document";
  if (overwrite === "prompted") return "Replacement confirmation shown";
  return "Created new output document";
}
