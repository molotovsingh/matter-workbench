export const NATIVE_COMMAND_ALIASES = [
  ['prepare matter', '/prepare_matter'],
  ['prepare this matter', '/prepare_matter'],
  ['matter prep', '/prepare_matter'],
  ['setup matter', '/matter-init'],
  ['set up matter', '/matter-init'],
  ['extract', '/extract'],
  ['describe sources', '/describe_sources'],
  ['source labels', '/describe_sources'],
  ['context', '/context_preview'],
  ['show context', '/context_preview'],
  ['preview matter context', '/context_preview'],
  ['find in matter', '/context_search'],
  ['case timeline', '/create_listofdates'],
  ['build case timeline', '/create_listofdates'],
  ['list of dates', '/create_listofdates'],
  ['create list of dates', '/create_listofdates'],
  ['chronology', '/create_listofdates'],
  ['the story', '/the_story'],
  ['matter story', '/the_story'],
  ['write matter story', '/the_story'],
  ['doctor', '/doctor'],
  ['check matter health', '/doctor'],
] as const;

const NATIVE_COMMAND_ALIAS_MAP = new Map<string, string>(NATIVE_COMMAND_ALIASES);

export function getNativeCommandAlias(input: string): string | null {
  return NATIVE_COMMAND_ALIAS_MAP.get(normalizeCommandInput(input)) ?? null;
}

function normalizeCommandInput(input: string): string {
  return String(input || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
