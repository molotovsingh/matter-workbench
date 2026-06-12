import type { PrivateBetaFeedbackChoice, PrivateBetaFeedbackRequest } from '../types';

interface PrivateBetaFeedbackDraftInput {
  choice: PrivateBetaFeedbackChoice | '';
  tryingToDo: string;
  happenedInstead: string;
}

type PrivateBetaFeedbackDraft = Pick<PrivateBetaFeedbackRequest, 'choice' | 'tryingToDo' | 'happenedInstead'>;

export function hasPrivateBetaFeedbackDraftText(input: PrivateBetaFeedbackDraftInput): boolean {
  return Boolean(feedbackDraftText(input));
}

export function buildPrivateBetaFeedbackDraft(input: PrivateBetaFeedbackDraftInput): PrivateBetaFeedbackDraft | null {
  const tryingToDo = input.tryingToDo.trim();
  const happenedInstead = input.happenedInstead.trim();
  const summary = feedbackDraftText(input);
  if (!summary) return null;

  return {
    choice: input.choice || 'did_not_work',
    tryingToDo: tryingToDo || summary,
    happenedInstead: happenedInstead || undefined,
  };
}

function feedbackDraftText(input: PrivateBetaFeedbackDraftInput): string {
  return input.happenedInstead.trim() || input.tryingToDo.trim();
}
