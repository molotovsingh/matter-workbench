export interface CopilotThreadTurn {
  role: 'user' | 'assistant';
  mode: 'ask' | 'research';
  text: string;
}

export interface CopilotConversationTurn {
  role: 'user' | 'assistant';
  mode: 'ask' | 'research';
  content: string;
}

const MAX_CONVERSATION_TURNS = 6;
const MAX_CONVERSATION_TURN_CHARS = 1200;

export function appendCopilotThreadTurn(
  turns: CopilotThreadTurn[],
  turn: CopilotThreadTurn,
  maxTurns = 12,
): CopilotThreadTurn[] {
  return [...turns, turn].slice(-Math.max(1, maxTurns));
}

export function boundedConversationForRequest(turns: CopilotThreadTurn[]): CopilotConversationTurn[] {
  return turns.slice(-MAX_CONVERSATION_TURNS).map((turn) => ({
    role: turn.role,
    mode: turn.mode,
    content: turn.text.slice(0, MAX_CONVERSATION_TURN_CHARS),
  }));
}
