export const LEGAL_SOURCE_ID_PATTERN: string;
export const LEGAL_SOURCE_ID_RE: RegExp;
export const LEGAL_SOURCE_ID_GLOBAL_RE: RegExp;
export const STATUTE_SOURCE_ID_RE: RegExp;
export function normalizeLegalSourceId(value?: unknown): string;
export function isLegalSourceId(value?: unknown): boolean;
export function isStatuteSourceId(value?: unknown): boolean;
export function extractLegalSourceIds(value?: unknown): string[];
