const GREETINGS = /^(hi|hello|hey|greetings|good morning|good afternoon|good evening|howdy|sup|yo)\b/i;
const CASUAL = /^(thanks|thank you|bye|goodbye|see you|later|ok|okay|cool|awesome|great|nice)\b/i;

export function isLocalOnlyIntent(userInput) {
  if (!userInput || typeof userInput !== "string") return false;
  const trimmed = userInput.trim();
  if (trimmed.startsWith("/")) return true;
  if (GREETINGS.test(trimmed)) return true;
  if (CASUAL.test(trimmed) && trimmed.split(/\s+/).length <= 3) return true;
  return false;
}

export { GREETINGS, CASUAL };
