export const MATTER_WORKSPACE_LANES = [
  {
    path: "00_Inbox",
    label: "Inbox",
    purpose: "intake batches, source preservation, file registers, and extraction logs",
  },
  {
    path: "10_Library",
    label: "Analysis Library",
    purpose: "reliable source-backed analysis such as source labels and List of Dates artifacts",
  },
  {
    path: "20_Workshop",
    label: "Workshop",
    purpose: "review work, issue notes, contradictions, fact gaps, and strategy working material",
  },
  {
    path: "30_Drafts",
    label: "Drafts",
    purpose: "draft legal outputs before final review",
  },
  {
    path: "40_Dispatch",
    label: "Dispatch",
    purpose: "reviewed sendable material and export-ready outputs",
  },
];

export const MATTER_WORKSPACE_LANE_LABELS = new Map(
  MATTER_WORKSPACE_LANES.map((lane) => [lane.path, lane.label]),
);

export function workspaceLaneLabel(relativePath, fallback = "") {
  return MATTER_WORKSPACE_LANE_LABELS.get(String(relativePath || "").replace(/\\/g, "/")) || fallback;
}
