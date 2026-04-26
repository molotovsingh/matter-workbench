export const REQUIRED_METADATA = [
  { key: "clientName", label: "Client name" },
  { key: "matterName", label: "Matter name" },
  { key: "oppositeParty", label: "Opposite party" },
  { key: "matterType", label: "Matter type" },
  { key: "jurisdiction", label: "Jurisdiction" },
];

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateMetadata(metadata = {}) {
  return REQUIRED_METADATA
    .filter(({ key }) => !(metadata[key] && metadata[key].trim()))
    .map(({ label }) => label);
}

export function metadataFromMatterJson(rawMatter, fallbackName = "") {
  return {
    clientName: rawMatter.client_name || "",
    matterName: rawMatter.matter_name || fallbackName,
    oppositeParty: rawMatter.opposite_party || "",
    matterType: rawMatter.matter_type || "",
    jurisdiction: rawMatter.jurisdiction || "",
    briefDescription: rawMatter.brief_description || "",
  };
}

export function matterFromWorkspace(workspace) {
  return {
    name: workspace.metadata.matterName || workspace.folderName,
    folderName: workspace.folderName,
    inputLabel: workspace.inputLabel,
    fileCount: workspace.fileCount,
    directoryCount: workspace.directoryCount,
    tree: workspace.tree,
    metadata: workspace.metadata,
  };
}

export function buildMatterJson(activeMatter) {
  const metadata = activeMatter.metadata;

  return {
    matter_id: activeMatter.folderName,
    matter_name: metadata.matterName,
    client_name: metadata.clientName,
    opposite_party: metadata.oppositeParty,
    matter_type: metadata.matterType,
    jurisdiction: metadata.jurisdiction,
    brief_description: metadata.briefDescription,
    source_root: activeMatter.inputLabel,
    phase: "phase_1_intake",
    intake_id: "INTAKE-01",
    intake: {
      scanned_files: activeMatter.fileCount,
      scanned_folders: activeMatter.directoryCount,
      preserve_originals_at: "00_Inbox/Intake 01 - Initial/Originals",
      arrange_working_copies_at: "00_Inbox/Intake 01 - Initial/By Type",
      review_logs: [
        "00_Inbox/Intake 01 - Initial/Intake Log.csv",
        "00_Inbox/Intake 01 - Initial/File Register.csv",
      ],
    },
  };
}

export function buildPreviewResultLines(activeMatter, command) {
  return [
    `> workbench.run ${command}`,
    `[intake] confirming matter root: ${activeMatter.inputLabel}`,
    `[intake] validating matter metadata: ${activeMatter.metadata.matterName}`,
    `[intake] scanned ${activeMatter.fileCount} files and ${activeMatter.directoryCount} folders`,
    "[intake] prototype mode: no files written",
    "[intake] would write matter.json",
    "[intake] would preserve originals under 00_Inbox/Intake 01 - Initial/Originals/",
    "[intake] would arrange copies under 00_Inbox/Intake 01 - Initial/By Type/",
    "[intake] would write Intake Log.csv and File Register.csv",
    "[intake] status: complete - intake ready for lawyer review",
  ];
}
