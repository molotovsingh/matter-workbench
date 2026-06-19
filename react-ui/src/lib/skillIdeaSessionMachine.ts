import type {
  SkillIdea,
  SkillIdeaDesignBrief,
  SkillInterviewPlanResponse,
  SkillRouterDecision,
} from '../types';
import { SKILL_SAMPLE_STATE } from './skillSampleStates';
import {
  SKILL_IDEA_KICKOFF_QUESTIONS,
  SKILL_IDEA_NAME_QUESTION,
  type InterviewQuestion,
} from './skillIdeaSession';

export type SkillIdeaSessionPhase =
  | 'planning'
  | 'interviewing'
  | 'ready'
  | 'saving'
  | 'saved'
  | 'sampling'
  | 'sampled'
  | 'creating'
  | 'created';

export interface SkillIdeaSessionSample {
  id: string;
  output: string;
  warnings?: string[];
  approved?: boolean;
  version?: number;
  state?: string;
  matterFolder?: string;
}

export interface SkillIdeaSessionState {
  phase: SkillIdeaSessionPhase;
  ideaText: string;
  understoodText: string;
  questions: InterviewQuestion[];
  answers: Record<string, string>;
  questionIndex: number;
  planner: SkillInterviewPlanResponse['planner'] | null;
  plannedBrief: SkillIdeaDesignBrief | null;
  defaultAssumptions: string[];
  riskFlags: string[];
  savedIdeaId: string | null;
  savedIdea: SkillIdea | null;
  designBrief: SkillIdeaDesignBrief | null;
  sample: SkillIdeaSessionSample | null;
  answersDirtySinceSave: boolean;
  overlapGate: { decision: SkillRouterDecision; userRequest: string } | null;
  overlapJustification: string;
  createdSkill: { slash?: string; name?: string } | null;
  notice: string | null;
  error: string | null;
}

export interface CreateSkillIdeaSessionStateOptions {
  ideaText: string;
  startsWithBlankIdea: boolean;
  startsFromSavedIdea: boolean;
  initialIdea: SkillIdea | null;
}

export type SkillIdeaSessionTransition =
  | { type: 'answer_question'; answer: string }
  | { type: 'start_saving' }
  | { type: 'start_sampling' }
  | { type: 'start_creating' }
  | { type: 'edit_answers' }
  | { type: 'show_guidance'; message: string }
  | { type: 'set_overlap_justification'; overlapJustification: string }
  | { type: 'park_overlap_gate' };

export function createInitialSkillIdeaSessionState({
  ideaText,
  startsWithBlankIdea,
  startsFromSavedIdea,
  initialIdea,
}: CreateSkillIdeaSessionStateOptions): SkillIdeaSessionState {
  return {
    phase: startsFromSavedIdea ? 'saved' : startsWithBlankIdea ? 'interviewing' : 'planning',
    ideaText,
    understoodText: ideaText,
    questions: startsWithBlankIdea ? [...SKILL_IDEA_KICKOFF_QUESTIONS, SKILL_IDEA_NAME_QUESTION] : [],
    answers: startsFromSavedIdea ? { skillName: ideaText } : {},
    questionIndex: 0,
    planner: null,
    plannedBrief: initialIdea?.designBrief || null,
    defaultAssumptions: [],
    riskFlags: [],
    savedIdeaId: initialIdea?.id || null,
    savedIdea: initialIdea,
    designBrief: initialIdea?.designBrief || null,
    sample: null,
    answersDirtySinceSave: false,
    overlapGate: null,
    overlapJustification: '',
    createdSkill: null,
    notice: null,
    error: null,
  };
}

export function reduceSkillIdeaSessionState(
  state: SkillIdeaSessionState,
  transition: SkillIdeaSessionTransition,
): SkillIdeaSessionState {
  switch (transition.type) {
    case 'answer_question':
      return answerSkillIdeaQuestion(state, transition.answer);
    case 'start_saving':
      return { ...state, phase: 'saving', notice: null, error: null };
    case 'start_sampling':
      return {
        ...state,
        phase: 'sampling',
        overlapGate: null,
        overlapJustification: '',
        notice: null,
        error: null,
      };
    case 'start_creating':
      return { ...state, phase: 'creating', error: null };
    case 'edit_answers':
      return {
        ...state,
        phase: state.questions.length ? 'interviewing' : 'ready',
        questionIndex: 0,
        notice: state.sample ? 'Editing answers will require a fresh sample before creating the skill.' : state.notice,
        error: null,
      };
    case 'show_guidance':
      return { ...state, notice: transition.message, error: null };
    case 'set_overlap_justification':
      return { ...state, overlapJustification: transition.overlapJustification };
    case 'park_overlap_gate':
      return { ...state, overlapGate: null, overlapJustification: '', error: null };
    default:
      return assertNever(transition);
  }
}

function answerSkillIdeaQuestion(state: SkillIdeaSessionState, answer: string): SkillIdeaSessionState {
  const question = state.questions[state.questionIndex];
  if (!question) return { ...state, phase: 'ready' };
  const newAnswers = { ...state.answers, [question.id]: answer };
  const nextIndex = state.questionIndex + 1;
  const allDone = nextIndex >= state.questions.length;
  const editingSavedIdea = Boolean(state.savedIdeaId);
  return {
    ...state,
    answers: newAnswers,
    questionIndex: nextIndex,
    phase: allDone ? 'ready' : 'interviewing',
    answersDirtySinceSave: editingSavedIdea || state.answersDirtySinceSave,
    sample: editingSavedIdea ? markSkillIdeaSampleStale(state.sample) : state.sample,
    createdSkill: editingSavedIdea ? null : state.createdSkill,
    overlapGate: editingSavedIdea ? null : state.overlapGate,
    overlapJustification: editingSavedIdea ? '' : state.overlapJustification,
  };
}

export function markSkillIdeaSampleStale(sample: SkillIdeaSessionState['sample']): SkillIdeaSessionState['sample'] {
  if (!sample) return null;
  return {
    ...sample,
    approved: false,
    state: sample.approved ? SKILL_SAMPLE_STATE.APPROVED_STALE : SKILL_SAMPLE_STATE.STALE,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled skill idea session transition: ${JSON.stringify(value)}`);
}
