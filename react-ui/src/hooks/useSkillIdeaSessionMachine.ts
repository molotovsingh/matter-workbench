import { useState, useEffect, useCallback, useRef, type SetStateAction } from 'react';
import { api } from '../api/client';
import { useApp } from '../store/AppContext';
import { getErrorMessage } from '../lib/errors';
import { classifySkillIdeaSessionInput } from '../lib/skillIdeaSessionCommands';
import { parseSkillIdeaText } from '../lib/skillIdeaInput';
import { SKILL_IDEA_STATUS } from '../lib/skillIdeaStatuses';
import { isSkillSampleStaleState, SKILL_SAMPLE_STATE } from '../lib/skillSampleStates';
import {
  formatSkillIdeaPlannerTerminalLine,
  hasSkillIdeaTestMatter,
  normalizePlannedSkillIdeaInterview,
  SKILL_IDEA_KICKOFF_QUESTIONS,
  SKILL_IDEA_NAME_QUESTION,
  SIMPLE_SKILL_IDEA_QUESTIONS,
  type InterviewQuestion,
} from '../lib/skillIdeaSession';
import {
  approveAndCreateSkillFromIdeaSession,
  copySkillIdeaReviewPacket as copySkillIdeaReviewPacketAction,
  copySkillIdeaSample as copySkillIdeaSampleAction,
  copySkillIdeaSampleVersion as copySkillIdeaSampleVersionAction,
  generateSkillIdeaSessionSample,
  persistSkillIdeaSession,
} from '../lib/skillIdeaSessionActions';
import { useLatestValue } from './useLatestValue';
import type {
  SkillIdea,
  SkillIdeaDesignBrief,
  SkillInterviewPlanResponse,
  SkillRouterDecision,
} from '../types';

export interface SkillIdeaSessionState {
  phase: 'planning' | 'interviewing' | 'ready' | 'saving' | 'saved' | 'sampling' | 'sampled' | 'creating' | 'created';
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
  sample: { id: string; output: string; warnings?: string[]; approved?: boolean; version?: number; state?: string; matterFolder?: string } | null;
  answersDirtySinceSave: boolean;
  overlapGate: { decision: SkillRouterDecision; userRequest: string } | null;
  overlapJustification: string;
  createdSkill: { slash?: string; name?: string } | null;
  notice: string | null;
  error: string | null;
}

interface UseSkillIdeaSessionMachineProps {
  initialInput: string;
  onClose: () => void;
  onInputOverride: (handler: ((input: string) => boolean) | null) => void;
}

export function useSkillIdeaSessionMachine({
  initialInput,
  onClose,
  onInputOverride,
}: UseSkillIdeaSessionMachineProps) {
  const { state, appendTerminal, dispatch } = useApp();
  const ideaText = parseSkillIdeaText(initialInput) ?? initialInput;
  const startsWithBlankIdea = !ideaText.trim();
  const planningStarted = useRef(false);
  const mountedRef = useRef(true);
  const activeMatterRef = useLatestValue(state.activeMatter);
  const hasMatter = hasSkillIdeaTestMatter(state.activeMatter);

  const [session, setSession] = useState<SkillIdeaSessionState>({
    phase: startsWithBlankIdea ? 'interviewing' : 'planning',
    ideaText,
    understoodText: ideaText,
    questions: startsWithBlankIdea ? [...SKILL_IDEA_KICKOFF_QUESTIONS, SKILL_IDEA_NAME_QUESTION] : [],
    answers: {},
    questionIndex: 0,
    planner: null,
    plannedBrief: null,
    defaultAssumptions: [],
    riskFlags: [],
    savedIdeaId: null,
    savedIdea: null,
    designBrief: null,
    sample: null,
    answersDirtySinceSave: false,
    overlapGate: null,
    overlapJustification: '',
    createdSkill: null,
    notice: null,
    error: null,
  });

  const safeSetSession = useCallback((updater: SetStateAction<SkillIdeaSessionState>) => {
    if (mountedRef.current) setSession(updater);
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    if (planningStarted.current) return;
    planningStarted.current = true;
    void planInterview();
    async function planInterview() {
      appendTerminal(['[skill-idea] planning interview…']);
      const startingMatterName = activeMatterRef.current?.name || '';
      try {
        const result = await api.planSkillIdeaInterview({
          userRequest: initialInput,
          skillIdea: { text: ideaText },
          matterName: startingMatterName || undefined,
        });
        if (!isCurrentMatterName(startingMatterName)) {
          safeSetSession((s) => ({
            ...s,
            phase: 'ready',
            notice: 'Matter changed while planning. Start the skill idea again from the matter you want to use.',
            error: null,
          }));
          appendTerminal(['[skill-idea] ignored interview plan after matter changed']);
          return;
        }
        const planned = normalizePlannedSkillIdeaInterview(result, ideaText);
        safeSetSession((s) => {
          if (Object.keys(s.answers).length > 0) {
            return {
              ...s,
              planner: result.planner,
              error: null,
            };
          }
          return {
            ...s,
            phase: planned.questions.length ? 'interviewing' : 'ready',
            understoodText: planned.understoodText,
            questions: planned.questions,
            questionIndex: 0,
            plannedBrief: planned.designBrief,
            defaultAssumptions: planned.defaultAssumptions,
            riskFlags: planned.riskFlags,
            planner: result.planner,
            error: null,
          };
        });
        appendTerminal([formatSkillIdeaPlannerTerminalLine(result)]);
      } catch (e) {
        safeSetSession((s) => {
          if (Object.keys(s.answers).length > 0) {
            return {
              ...s,
              planner: null,
            };
          }
          return {
            ...s,
            phase: 'interviewing',
            questions: s.questions.length ? s.questions : SIMPLE_SKILL_IDEA_QUESTIONS,
            planner: null,
            error: `Planner unavailable; using a basic interview. ${getErrorMessage(e)}`,
          };
        });
        appendTerminal([`[skill-idea] planner unavailable; using basic interview: ${getErrorMessage(e)}`]);
      }
    }
  }, [activeMatterRef, appendTerminal, ideaText, initialInput, safeSetSession]);

  const handleAnswer = useCallback((answer: string) => {
    safeSetSession((s) => {
      const q = s.questions[s.questionIndex];
      if (!q) return { ...s, phase: 'ready' };
      const newAnswers = { ...s.answers, [q.id]: answer };
      const nextIndex = s.questionIndex + 1;
      const allDone = nextIndex >= s.questions.length;
      const editingSavedIdea = Boolean(s.savedIdeaId);
      return {
        ...s,
        answers: newAnswers,
        questionIndex: nextIndex,
        phase: allDone ? 'ready' : 'interviewing',
        answersDirtySinceSave: editingSavedIdea || s.answersDirtySinceSave,
        sample: editingSavedIdea ? markSkillIdeaSampleStale(s.sample) : s.sample,
        createdSkill: editingSavedIdea ? null : s.createdSkill,
        overlapGate: editingSavedIdea ? null : s.overlapGate,
        overlapJustification: editingSavedIdea ? '' : s.overlapJustification,
      };
    });
  }, [safeSetSession]);

  async function persistCurrentIdea(matterName = activeMatterRef.current?.name || '') {
    return persistSkillIdeaSession({ session, matterName });
  }

  async function handleSave() {
    const hadSample = Boolean(session.sample);
    const startingMatterName = activeMatterRef.current?.name || '';
    safeSetSession((s) => ({ ...s, phase: 'saving', notice: null, error: null }));
    appendTerminal(['[skill-idea] saving idea…']);
    try {
      const { brief, ideaTextForSave, savedIdea, updatingExistingIdea } = await persistCurrentIdea(startingMatterName);
      if (!isCurrentMatterName(startingMatterName)) {
        safeSetSession((s) => ({
          ...s,
          phase: s.savedIdeaId ? 'saved' : 'ready',
          notice: 'Matter changed while saving. Reopen the skill idea from the matter you want to use.',
          error: null,
        }));
        appendTerminal(['[skill-idea] ignored saved idea after matter changed']);
        return;
      }
      safeSetSession((s) => ({
        ...s,
        phase: 'saved',
        ideaText: ideaTextForSave,
        understoodText: s.understoodText || ideaTextForSave,
        savedIdeaId: savedIdea.id,
        savedIdea,
        designBrief: brief,
        sample: updatingExistingIdea ? null : s.sample,
        answersDirtySinceSave: false,
        overlapGate: null,
        overlapJustification: '',
        createdSkill: updatingExistingIdea ? null : s.createdSkill,
        notice: updatingExistingIdea && hadSample
          ? 'Answers changed. Generate a fresh sample before creating the skill.'
          : null,
      }));
      appendTerminal([`[skill-idea] ${updatingExistingIdea ? 'updated' : 'saved'} — id: ${savedIdea.id}`]);
    } catch (e) {
      safeSetSession((s) => ({ ...s, phase: 'ready', error: getErrorMessage(e) }));
    }
  }

  async function handleGenerateSample(feedback = '', previousSample = session.sample?.output || '') {
    const startingMatter = state.activeMatter;
    const startingMatterFolder = startingMatter?.folderName || '';
    const startingMatterName = startingMatter?.name || '';
    if (!hasSkillIdeaTestMatter(startingMatter)) {
      safeSetSession((s) => ({
        ...s,
        phase: s.savedIdeaId ? 'saved' : 'ready',
        notice: 'Pick a test matter before generating sample output.',
        error: null,
      }));
      appendTerminal(['[skill-idea] sample requested without active matter']);
      return;
    }
    const hadSavedIdea = Boolean(session.savedIdeaId && session.savedIdea);
    safeSetSession((s) => ({ ...s, phase: 'sampling', overlapGate: null, overlapJustification: '', notice: null, error: null }));
    try {
      let savedIdea = session.savedIdea;
      let savedIdeaId = session.savedIdeaId;
      if (!savedIdea || !savedIdeaId || session.answersDirtySinceSave) {
        appendTerminal([session.answersDirtySinceSave ? '[skill-idea] saving updated idea before sample…' : '[skill-idea] saving idea before sample…']);
        const saved = await persistCurrentIdea(startingMatterName);
        if (!isCurrentMatterName(startingMatterName)) {
          safeSetSession((s) => ({
            ...s,
            phase: session.savedIdeaId ? 'saved' : 'ready',
            notice: 'Matter changed while saving. Pick the test matter again before generating a sample.',
            error: null,
          }));
          appendTerminal(['[skill-idea] ignored saved idea before sample after matter changed']);
          return;
        }
        savedIdea = saved.savedIdea;
        savedIdeaId = saved.savedIdea.id;
        safeSetSession((s) => ({
          ...s,
          savedIdeaId,
          savedIdea,
          designBrief: savedIdea?.designBrief || s.designBrief,
          answersDirtySinceSave: false,
          ideaText: saved.ideaTextForSave,
          understoodText: s.understoodText || saved.ideaTextForSave,
        }));
      }
      appendTerminal([feedback ? '[skill-idea] regenerating sample output…' : '[skill-idea] generating sample output…']);
      const generatedSample = await generateSkillIdeaSessionSample({
        idea: savedIdea,
        feedback,
        previousSample,
      });
      const latestMatterFolder = activeMatterRef.current?.folderName || '';
      const resultMatterFolder = generatedSample.matterFolder;
      if (latestMatterFolder !== startingMatterFolder || (resultMatterFolder && resultMatterFolder !== startingMatterFolder)) {
        safeSetSession((s) => ({
          ...s,
          phase: savedIdeaId ? 'saved' : 'ready',
          savedIdeaId,
          savedIdea,
          designBrief: savedIdea?.designBrief || s.designBrief,
          answersDirtySinceSave: false,
          notice: 'Sample finished for a different matter context. Pick the test matter again and regenerate before creating the skill.',
          error: null,
        }));
        appendTerminal(['[skill-idea] ignored sample result after matter changed']);
        return;
      }
      safeSetSession((s) => ({
        ...s,
        phase: 'sampled',
        savedIdeaId,
        savedIdea,
        designBrief: savedIdea?.designBrief || s.designBrief,
        answersDirtySinceSave: false,
        sample: generatedSample.sampleId && generatedSample.output
          ? {
              id: generatedSample.sampleId,
              output: generatedSample.output,
              warnings: generatedSample.warnings,
              version: generatedSample.version,
              approved: generatedSample.approved,
              state: generatedSample.state,
              matterFolder: resultMatterFolder || startingMatterFolder,
            }
          : null,
        notice: null,
      }));
      appendTerminal(['[skill-idea] sample ready']);
    } catch (e) {
      safeSetSession((s) => ({ ...s, phase: hadSavedIdea ? 'saved' : 'ready', error: getErrorMessage(e) }));
    }
  }

  async function handleApproveSample(overlapOverrideJustification = '') {
    if (!session.savedIdeaId || !session.savedIdea || !session.sample) return;
    const savedIdea = session.savedIdea;
    const sample = session.sample;
    if (session.answersDirtySinceSave) {
      showSessionGuidance('Save updates and generate a fresh sample before creating the skill.');
      return;
    }
    if (isSkillSampleStaleState(sample.state)) {
      showSessionGuidance('Regenerate the sample after the design brief changes before creating the skill.');
      return;
    }
    if (sampleMatterChanged(sample)) {
      showSessionGuidance('Pick the sample matter again before creating the skill.');
      return;
    }
    const startingMatterName = activeMatterRef.current?.name || '';
    safeSetSession((s) => ({ ...s, phase: 'creating', error: null }));
    appendTerminal(['[skill-idea] approving sample and checking skill overlap…']);
    try {
      const result = await approveAndCreateSkillFromIdeaSession({
        ideaId: session.savedIdeaId,
        idea: savedIdea,
        designBrief: session.designBrief || savedIdea.designBrief,
        sample,
        overlapOverrideJustification,
        matterName: startingMatterName,
        isCurrentMatterName,
        onCreating: () => appendTerminal(['[skill-idea] creating skill from approved sample…']),
      });
      if (result.status === 'matter_changed') {
        safeSetSession((s) => ({
          ...s,
          phase: 'sampled',
          notice: 'Matter changed while checking overlap. Pick the sample matter again before creating the skill.',
          error: null,
        }));
        appendTerminal(['[skill-idea] ignored overlap check after matter changed']);
        return;
      }
      if (result.status === 'blocked') {
        safeSetSession((s) => ({
          ...s,
          phase: 'sampled',
          sample: s.sample ? { ...s.sample, approved: true } : s.sample,
          overlapGate: { decision: result.decision, userRequest: result.userRequest },
          error: null,
        }));
        appendTerminal([`[skill-idea] existing skill review needed${result.decision.matched_skill ? `: ${result.decision.matched_skill}` : ''}`]);
        return;
      }
      safeSetSession((s) => ({
        ...s,
        phase: 'created',
        overlapGate: null,
        overlapJustification: '',
        sample: s.sample ? { ...s.sample, approved: true } : s.sample,
        createdSkill: result.skill ? { slash: result.skill.slash, name: result.skill.title } : { name: 'New skill' },
      }));
      appendTerminal([`[skill-idea] skill created: ${result.skill?.title ?? 'New skill'}`]);
      dispatch({ type: 'SET_TAB', payload: 'skills' });
    } catch (e) {
      safeSetSession((s) => ({ ...s, phase: 'sampled', error: getErrorMessage(e) }));
    }
  }

  async function handleCopySample() {
    if (!session.sample) return;
    try {
      await copySkillIdeaSampleAction(session.sample);
      appendTerminal(['[skill-idea] sample copied']);
      safeSetSession((s) => ({ ...s, error: null }));
    } catch (e) {
      const message = getErrorMessage(e);
      appendTerminal([`[skill-idea] sample copy failed: ${message}`]);
      safeSetSession((s) => ({ ...s, error: `Copy failed: ${message}` }));
    }
  }

  async function handleCopySampleVersion(version: number) {
    if (!session.savedIdeaId) {
      showSessionGuidance('Save the idea before copying sample versions.');
      return;
    }
    try {
      const copied = await copySkillIdeaSampleVersionAction(session.savedIdeaId, version);
      if (!copied) {
        showSessionGuidance(`Sample v${Number(version || 0) || '?'} is not available in the ledger.`);
        return;
      }
      appendTerminal([`[skill-idea] copied sample v${version}`]);
      safeSetSession((s) => ({ ...s, error: null }));
    } catch (e) {
      const message = getErrorMessage(e);
      appendTerminal([`[skill-idea] sample version copy failed: ${message}`]);
      safeSetSession((s) => ({ ...s, error: `Copy failed: ${message}` }));
    }
  }

  async function handleCopyReviewPacket() {
    if (!session.savedIdea) {
      showSessionGuidance('Save the idea before copying a review packet.');
      return;
    }
    try {
      await copySkillIdeaReviewPacketAction(session.savedIdea, {
        onRegistryError: (error) => {
          appendTerminal([`[skill-idea] copied review packet without registry classification: ${getErrorMessage(error)}`]);
        },
      });
      appendTerminal([`[skill-idea] copied review packet for ${session.savedIdea.id}`]);
      safeSetSession((s) => ({ ...s, error: null }));
    } catch (e) {
      const message = getErrorMessage(e);
      appendTerminal([`[skill-idea] review packet copy failed: ${message}`]);
      safeSetSession((s) => ({ ...s, error: `Copy failed: ${message}` }));
    }
  }

  function handleEditAnswers() {
    safeSetSession((s) => ({
      ...s,
      phase: s.questions.length ? 'interviewing' : 'ready',
      questionIndex: 0,
      notice: s.sample ? 'Editing answers will require a fresh sample before creating the skill.' : s.notice,
      error: null,
    }));
  }

  async function handleMarkReady() {
    if (!session.savedIdeaId) return;
    if (!session.savedIdea?.readiness?.ready) {
      showSessionGuidance('Complete every readiness item before marking ready for review.');
      return;
    }
    safeSetSession((s) => ({ ...s, notice: null, error: null }));
    try {
      const payload = await api.updateSkillIdeaStatus(session.savedIdeaId, { status: SKILL_IDEA_STATUS.READY_FOR_REVIEW });
      appendTerminal([`[skill-idea] marked ready for review — id: ${session.savedIdeaId}`]);
      safeSetSession((s) => ({
        ...s,
        savedIdea: payload.idea || (s.savedIdea ? { ...s.savedIdea, status: SKILL_IDEA_STATUS.READY_FOR_REVIEW } : s.savedIdea),
        notice: 'Marked ready for review. Open Skills to review the saved idea.',
      }));
    } catch (e) {
      safeSetSession((s) => ({ ...s, error: getErrorMessage(e) }));
    }
  }

  function setOverlapJustification(overlapJustification: string) {
    safeSetSession((s) => ({ ...s, overlapJustification }));
  }

  function parkOverlapGate() {
    safeSetSession((s) => ({ ...s, overlapGate: null, overlapJustification: '', error: null }));
  }

  function closeSession() {
    onInputOverride(null);
    onClose();
  }

  function showSessionGuidance(message: string) {
    safeSetSession((s) => ({ ...s, notice: message, error: null }));
  }

  function isCurrentMatterName(matterName: string) {
    return (activeMatterRef.current?.name || '') === matterName;
  }

  function sampleMatterChanged(sample: SkillIdeaSessionState['sample']) {
    if (!sample?.matterFolder) return false;
    return (activeMatterRef.current?.folderName || '') !== sample.matterFolder;
  }

  function handleSessionCommand(input: string): boolean {
    const sampleIsCurrent = Boolean(session.sample && !session.answersDirtySinceSave && !isSkillSampleStaleState(session.sample.state));
    const ready = session.phase !== 'planning' && session.phase !== 'interviewing'
      && session.phase !== 'saving' && session.phase !== 'sampling' && session.phase !== 'creating';
    const command = classifySkillIdeaSessionInput(input, {
      ready,
      hasSavedIdea: Boolean(session.savedIdeaId),
      hasActiveSample: Boolean(session.sample),
      sampleApproved: Boolean(session.sample?.approved && sampleIsCurrent),
    });

    if (command.action === 'cancel') {
      closeSession();
      return true;
    }
    if (command.action === 'blank') {
      showSessionGuidance(ready ? 'Use Save idea, Generate sample, Edit answers, Open Skills, or Cancel.' : 'Answer the current question, or choose Cancel.');
      return true;
    }
    if (command.action === 'answer_question') {
      if (session.phase === 'interviewing') {
        handleAnswer(input);
        return true;
      }
      return false;
    }
    if (!ready) {
      showSessionGuidance('This skill idea step is still running. Wait for it to finish, or choose Cancel.');
      return true;
    }

    if (command.action === 'save') {
      void handleSave();
      return true;
    }
    if (command.action === 'generate_sample') {
      void handleGenerateSample(command.feedback);
      return true;
    }
    if (command.action === 'sample_feedback') {
      void handleGenerateSample(command.feedback, session.sample?.output || '');
      return true;
    }
    if (command.action === 'copy_sample') {
      void handleCopySample();
      return true;
    }
    if (command.action === 'approve_sample' || command.action === 'create_skill') {
      if (!session.sample) {
        showSessionGuidance('Generate a sample before creating the skill.');
        return true;
      }
      void handleApproveSample();
      return true;
    }
    if (command.action === 'edit_answers') {
      handleEditAnswers();
      return true;
    }
    if (command.action === 'mark_ready') {
      if (!session.savedIdeaId) {
        showSessionGuidance('Save the idea before marking it ready for review.');
        return true;
      }
      void handleMarkReady();
      return true;
    }
    if (command.action === 'open_skills') {
      dispatch({ type: 'SET_TAB', payload: 'skills' });
      dispatch({ type: 'SET_BREADCRUMBS', payload: 'Skills' });
      return true;
    }
    if (command.action === 'start_another') {
      closeSession();
      return true;
    }
    if (command.action === 'copy_sample_version') {
      void handleCopySampleVersion(command.version);
      return true;
    }
    if (command.action === 'copy_review_packet') {
      void handleCopyReviewPacket();
      return true;
    }
    return false;
  }

  useEffect(() => {
    onInputOverride(handleSessionCommand);
    return () => onInputOverride(null);
  });

  const currentQuestion = session.phase === 'interviewing' && session.questionIndex < session.questions.length
    ? session.questions[session.questionIndex]
    : null;

  return {
    session,
    currentQuestion,
    hasMatter,
    actions: {
      closeSession,
      handleAnswer,
      handleApproveSample,
      handleCopySample,
      handleEditAnswers,
      handleGenerateSample,
      handleSave,
      parkOverlapGate,
      setOverlapJustification,
    },
  };
}

function markSkillIdeaSampleStale(sample: SkillIdeaSessionState['sample']): SkillIdeaSessionState['sample'] {
  if (!sample) return null;
  return {
    ...sample,
    approved: false,
    state: sample.approved ? SKILL_SAMPLE_STATE.APPROVED_STALE : SKILL_SAMPLE_STATE.STALE,
  };
}
