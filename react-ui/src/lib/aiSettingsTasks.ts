import type { AiSettings } from '../types';

export function findAiTask(settings: AiSettings | null, taskName: string) {
  return settings?.aiTasks?.find((task) => task.task === taskName) || null;
}

export function findCopilotTask(settings: AiSettings | null) {
  return findAiTask(settings, 'copilot_answer');
}
