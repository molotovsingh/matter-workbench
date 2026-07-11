export const MATTER_WORKSPACE_LANES = [
  {
    path: "00_Inbox",
    label: "00_Inbox",
    purpose: "Files received from the client, court, or other side.",
  },
  {
    path: "10_Library",
    label: "10_Library",
    purpose: "Extracted text, source labels, and citeable references.",
  },
  {
    path: "20_Workshop",
    label: "20_Workshop",
    purpose: "Chronologies, risks, issue notes, party maps, and strategy.",
  },
  {
    path: "30_Drafts",
    label: "30_Drafts",
    purpose: "Formal documents in draft form.",
  },
  {
    path: "40_Dispatch",
    label: "40_Dispatch",
    purpose: "Reviewed documents for filing, sending, or sharing.",
  },
];

export const MATTER_WORKSPACE_LANE_LABELS = new Map(
  MATTER_WORKSPACE_LANES.map((lane) => [lane.path, lane.path]),
);

export function workspaceLaneLabel(relativePath, fallback = "") {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  return MATTER_WORKSPACE_LANE_LABELS.get(normalized) || fallback;
}
