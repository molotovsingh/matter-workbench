const GREETINGS = /^(?:(?:hi|hello|hey|greetings|howdy|sup|yo)(?:\s+there)?|good\s+(?:morning|afternoon|evening))[.!?]*$/i;
const CASUAL = /^(?:thanks(?:\s+again)?|thank\s+you|bye|goodbye|see\s+you(?:\s+later)?|later|ok|okay|cool|awesome|great|nice)[.!?]*$/i;

export function isLocalOnlyIntent(userInput) {
  if (!userInput || typeof userInput !== "string") return false;
  const trimmed = userInput.trim();
  if (trimmed.startsWith("/")) return true;
  if (GREETINGS.test(trimmed)) return true;
  if (CASUAL.test(trimmed) && trimmed.split(/\s+/).length <= 3) return true;
  return false;
}

export { GREETINGS, CASUAL };
