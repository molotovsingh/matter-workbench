import type { ActiveView } from '../types';
import { getNativeCommandAlias } from './nativeCommandAliases';

export interface NativeCommandDefinition {
  command: string;
  label: string;
  description: string;
  view: ActiveView;
  pill: 'Local' | 'Uses AI';
  showInSidebar: boolean;
  showInCommandPanel: boolean;
  overviewPlacement?: 'primary' | 'secondary';
}

export const NATIVE_COMMANDS: NativeCommandDefinition[] = [
  {
    command: '/matter-init',
    label: 'Set up matter',
    description: 'Prepare the matter folder',
    view: 'prepare-matter',
    pill: 'Local',
    showInSidebar: true,
    showInCommandPanel: true,
    overviewPlacement: 'primary',
  },
  {
    command: '/prepare_matter',
    label: 'Prepare matter',
    description: 'Check setup and run the next safe step',
    view: 'prepare-matter',
    pill: 'Local',
    showInSidebar: true,
    showInCommandPanel: true,
    overviewPlacement: 'primary',
  },
  {
    command: '/extract',
    label: 'Read documents',
    description: 'Read supported files for later review',
    view: 'extract',
    pill: 'Local',
    showInSidebar: true,
    showInCommandPanel: true,
    overviewPlacement: 'secondary',
  },
  {
    command: '/describe_sources',
    label: 'Source Labels / Document Index',
    description: 'Organize documents and prepare source labels',
    view: 'describe-sources',
    pill: 'Uses AI',
    showInSidebar: true,
    showInCommandPanel: true,
    overviewPlacement: 'secondary',
  },
  {
    command: '/context_preview',
    label: 'Preview matter context',
    description: 'Review the bounded matter context',
    view: 'context-preview',
    pill: 'Local',
    showInSidebar: true,
    showInCommandPanel: true,
  },
  {
    command: '/context_search',
    label: 'Find in matter',
    description: 'Search the matter context',
    view: 'context-search',
    pill: 'Local',
    showInSidebar: true,
    showInCommandPanel: true,
  },
  {
    command: '/create_listofdates',
    label: 'Create List of Dates',
    description: 'Build the source-backed chronology',
    view: 'list-of-dates',
    pill: 'Uses AI',
    showInSidebar: true,
    showInCommandPanel: true,
    overviewPlacement: 'secondary',
  },
  {
    command: '/the_story',
    label: 'Write Matter Story',
    description: 'Write the Matter Story from the current List of Dates',
    view: 'home',
    pill: 'Uses AI',
    showInSidebar: true,
    showInCommandPanel: true,
    overviewPlacement: 'primary',
  },
  {
    command: '/doctor',
    label: 'Check matter health',
    description: 'Run local diagnostics',
    view: 'doctor',
    pill: 'Local',
    showInSidebar: true,
    showInCommandPanel: true,
    overviewPlacement: 'secondary',
  },
];

const COMMANDS_BY_SLASH = NATIVE_COMMANDS.reduce<Record<string, NativeCommandDefinition>>((acc, command) => {
  acc[command.command] = command;
  return acc;
}, {});

export const SIDEBAR_NATIVE_COMMANDS = NATIVE_COMMANDS.filter((command) => command.showInSidebar);

export const OVERVIEW_NATIVE_COMMANDS = NATIVE_COMMANDS.filter((command) => command.overviewPlacement);

export const COMMAND_PANEL_NATIVE_SUGGESTIONS = NATIVE_COMMANDS
  .filter((command) => command.showInCommandPanel)
  .map((command) => ({
    label: command.label,
    description: command.description,
    command: command.command,
  }));

export function getNativeCommandView(command: string): ActiveView | null {
  return COMMANDS_BY_SLASH[normalizeCommand(command)]?.view ?? null;
}

export interface NativeCommandResolution {
  command: string;
  view: ActiveView;
}

export function resolveNativeCommand(input: string): NativeCommandResolution | null {
  const normalized = normalizeCommand(input);
  const exactView = getNativeCommandView(normalized);
  if (exactView) return { command: normalized, view: exactView };

  const aliasCommand = getNativeCommandAlias(normalized);
  const aliasView = aliasCommand ? getNativeCommandView(aliasCommand) : null;
  if (aliasCommand && aliasView) return { command: aliasCommand, view: aliasView };

  return null;
}

export function cleanCommandLabel(command: string): string {
  const normalized = normalizeCommand(command);
  if (COMMANDS_BY_SLASH[normalized]) return COMMANDS_BY_SLASH[normalized].label;
  return (command || 'Action')
    .replace(/^\/+/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Action';
}

export function commandPill(command: string): string {
  return COMMANDS_BY_SLASH[normalizeCommand(command)]?.pill ?? 'Uses AI';
}

function normalizeCommand(command: string): string {
  return command.toLowerCase().trim();
}
