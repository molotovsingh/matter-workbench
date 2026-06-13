const MATTER_DETAIL_LABELS: Record<string, string> = {
  clientName: 'Client',
  matterName: 'Matter name',
  matterType: 'Matter type',
  jurisdiction: 'Jurisdiction',
  oppositeParty: 'Opposite party',
  briefDescription: 'Description',
};

export function formatMissingMatterDetails(fields: readonly string[] = []): string {
  return fields.map((field) => MATTER_DETAIL_LABELS[field] || humanizeFieldName(field)).join(', ');
}

function humanizeFieldName(field: string): string {
  return String(field || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}
