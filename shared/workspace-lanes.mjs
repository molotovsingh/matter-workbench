export const MATTER_WORKSPACE_LANES = [
  {
    path: "00_Inbox",
    label: "Original Documents",
    purpose: "Files received from the client, court, or other side.",
    group: "case_record",
  },
  {
    path: "10_Library",
    label: "Source Record",
    purpose: "Extracted text, source labels, and citeable references.",
    group: "case_record",
  },
  {
    path: "20_Workshop",
    label: "Case Analysis",
    purpose: "Chronologies, risks, issue notes, party maps, and strategy.",
  },
  {
    path: "30_Drafts",
    label: "Drafts",
    purpose: "Formal documents in draft form.",
  },
  {
    path: "40_Dispatch",
    label: "Ready to Send",
    purpose: "Reviewed documents for filing, sending, or sharing.",
  },
];

export const MATTER_WORKSPACE_GROUPS = [
  {
    id: "case_record",
    label: "Case Record",
    purpose: "Original files and the app's indexed source record.",
    lanes: ["00_Inbox", "10_Library"],
  },
];

export const MATTER_WORKSPACE_LANE_LABELS = new Map(
  MATTER_WORKSPACE_LANES.map((lane) => [lane.path, lane.label]),
);

export function workspaceLaneLabel(relativePath, fallback = "") {
  return MATTER_WORKSPACE_LANE_LABELS.get(String(relativePath || "").replace(/\\/g, "/")) || fallback;
}
