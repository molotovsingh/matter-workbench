export function shouldSuggestResearchForAsk(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  if (/^(?:\/research|research)\b/i.test(text)) return false;
  if (/^(?:\/ask|ask)\b/i.test(text)) return false;

  const legalResearchSignals = [
    /\bwhich\s+(?:section|sections|provision|provisions|rule|rules)\b/i,
    /\b(?:case\s*law|judgments?|authorit(?:y|ies)|precedents?)\b/i,
    /\b(?:latest|recent|current)\s+(?:law|position|judgments?|cases?|authorit(?:y|ies))\b/i,
    /\b(?:NCLT|NCLAT|IBC|CIRP|IRP|RP|resolution professional|liquidator)\b/i,
    /\b(?:Supreme Court|High Court|tribunal)\b/i,
    /\bwhat\s+(?:are|is)\s+the\s+(?:legal\s+)?options?\b/i,
  ];

  return legalResearchSignals.some((pattern) => pattern.test(text));
}
