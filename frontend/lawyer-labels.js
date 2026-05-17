const ACTION_LABELS = Object.freeze({
  "/prepare_matter": {
    label: "Prepare Matter",
    running: "Preparing matter",
    result: "Preparation complete",
    pill: "Guided",
  },
  "/matter-init": {
    label: "Set Up Matter",
    running: "Setting up matter",
    result: "Matter set up",
    pill: "Local",
  },
  "/extract": {
    label: "Extract Documents",
    running: "Extracting documents",
    result: "Documents extracted",
    pill: "Local",
  },
  "/describe_sources": {
    label: "Label Sources",
    resultLabel: "Source Labels",
    running: "Labeling sources",
    result: "Source labels complete",
    pill: "Uses AI",
  },
  "/create_listofdates": {
    label: "Create List of Dates",
    resultLabel: "List of Dates",
    running: "Creating List of Dates",
    result: "List of Dates complete",
    pill: "Uses AI",
  },
  "/context_preview": {
    label: "Preview Matter Context",
    running: "Preparing matter preview",
    result: "Matter preview ready",
    pill: "Local",
  },
  "/context_search": {
    label: "Search Matter Context",
    running: "Searching matter context",
    result: "Search complete",
    pill: "Local",
  },
  "/doctor": {
    label: "Check Matter",
    running: "Checking matter",
    result: "Matter check complete",
    pill: "Diagnostics",
  },
});

const ARTIFACT_LABELS = Object.freeze([
  [/^matter\.json$/i, "Matter metadata"],
  [/File Register\.csv$/i, "File Register"],
  [/Extraction Log\.csv$/i, "Extraction Log"],
  [/Source Index\.json$/i, "Source Labels record"],
  [/List of Dates\.md$/i, "List of Dates"],
  [/List of Dates\.json$/i, "List of Dates data"],
  [/List of Dates\.csv$/i, "List of Dates spreadsheet"],
  [/List of Dates Candidates\.json$/i, "Internal chronology candidates"],
]);

export function lawyerActionLabel(command, fallback = "Action") {
  const key = normalizeCommand(command);
  return ACTION_LABELS[key]?.label || cleanFallback(fallback);
}

export function lawyerActionResultLabel(command, fallback = "Result") {
  const key = normalizeCommand(command);
  return ACTION_LABELS[key]?.resultLabel || ACTION_LABELS[key]?.label || cleanFallback(fallback);
}

export function lawyerActionRunningLabel(command, fallback = "Running") {
  const key = normalizeCommand(command);
  return ACTION_LABELS[key]?.running || cleanFallback(fallback);
}

export function lawyerActionCompleteLabel(command, fallback = "Complete") {
  const key = normalizeCommand(command);
  return ACTION_LABELS[key]?.result || cleanFallback(fallback);
}

export function lawyerActionPill(command, { paidProviderCall = null } = {}) {
  const key = normalizeCommand(command);
  if (ACTION_LABELS[key]?.pill) return ACTION_LABELS[key].pill;
  if (paidProviderCall === true) return "Uses AI";
  if (paidProviderCall === false) return "Local";
  return "";
}

export function lawyerAiPostureLabel(value) {
  return value ? "Uses paid AI" : "Local";
}

export function lawyerModeLabel(mode) {
  const normalized = String(mode || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "deterministic") return "Local";
  if (normalized === "ai") return "Uses AI";
  return cleanFallback(mode);
}

export function lawyerArtifactLabel(artifactPath = "") {
  const path = String(artifactPath || "").trim();
  if (!path) return "Output";
  const match = ARTIFACT_LABELS.find(([pattern]) => pattern.test(path));
  if (match) return match[1];
  const fileName = path.split(/[\\/]/).filter(Boolean).pop() || path;
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Output";
}

export function normalizeCommand(command = "") {
  const value = String(command || "").trim();
  if (!value) return "";
  return value.startsWith("/") ? value : `/${value}`;
}

function cleanFallback(value = "") {
  return String(value || "")
    .replace(/^\/+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "Action";
}
