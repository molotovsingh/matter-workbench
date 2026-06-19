export const WORKSPACE_LANE_LABELS: Record<string, string> = {
  '00_Inbox': 'Case Record',
  '10_Library': 'Source Record',
  '20_Workshop': 'Case Analysis',
  '30_Drafts': 'Drafts',
  '40_Dispatch': 'Ready to Send',
};

export function workspaceLaneLabel(name: string): string | undefined {
  return WORKSPACE_LANE_LABELS[name];
}
