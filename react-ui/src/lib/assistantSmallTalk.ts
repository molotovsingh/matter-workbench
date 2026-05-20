const GREETING_PATTERN = /^(hi|hello|hey|hiya|namaste|good\s+(morning|afternoon|evening)|thanks|thank\s+you)[!. ]*$/i;

export function localAssistantReply(input: string, hasActiveMatter: boolean): string | null {
  const text = input.trim();
  if (!text) return null;
  if (!GREETING_PATTERN.test(text)) return null;

  if (hasActiveMatter) {
    return 'Hi. Ask me a specific question about this matter, or run a workflow like Source Labels, List of Dates, or Prepare Matter.';
  }

  return 'Hi. Pick a matter first, or use New Matter, Find a Matter, or Prepare Matter.';
}
