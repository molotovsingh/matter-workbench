import { useState, useEffect, useCallback, useRef, type SetStateAction } from 'react';
import { api } from '../api/client';
import { useApp } from '../store/AppContext';
import { getErrorMessage } from '../lib/errors';
import { classifySkillIdeaSessionInput } from '../lib/skillIdeaSessionCommands';
import { parseSkillIdeaText } from '../lib/skillIdeaInput';
import { SKILL_IDEA_STATUS } from '../lib/skillIdeaStatuses';
import { isSkillSampleStaleState } from '../lib/skillSampleStates';
import {
  formatSkillIdeaPlannerTerminalLine,
  hasSkillIdeaTestMatter,
  normalizePlannedSkillIdeaInterview,
  SIMPLE_SKILL_IDEA_QUESTIONS,
} from '../lib/skillIdeaSession';
import {
  approveAndCreateSkillFromIdeaSession,
  copySkillIdeaReviewPacket as copySkillIdeaReviewPacketAction,
  copySkillIdeaSample as copySkillIdeaSampleAction,
  copySkillIdeaSampleVersion as copySkillIdeaSampleVersionAction,
  generateSkillIdeaSessionSample,
  persistSkillIdeaSession,
} from '../lib/skillIdeaSessionActions';
import {
  createInitialSkillIdeaSessionState,
  reduceSkillIdeaSessionState,
  type SkillIdeaSessionState,
  type SkillIdeaSessionTransition,
} from '../lib/skillIdeaSessionMachine';
import { useLatestValue } from './useLatestValue';
import type { SkillIdea } from '../types';

interface UseSkillIdeaSessionMachineProps {
  initialInput: string;
  initialIdea?: SkillIdea | null;
  onClose: () => void;
  onInputOverride: (handler: ((input: string) => boolean) | null) => void;
}

type SkillIdeaAsyncOperation = 'plan' | 'save' | 'sample' | 'create' | 'mark-ready';

export function useSkillIdeaSessionMachine({
  initialInput,
  initialIdea = null,
  onClose,
  onInputOverride,
}: UseSkillIdeaSessionMachineProps) {
  const { state, appendTerminal, dispatch } = useApp();
  const ideaText = initialIdea?.text || (parseSkillIdeaText(initialInput) ?? initialInput);
  const startsWithBlankIdea = !ideaText.trim();
  const startsFromSavedIdea = Boolean(initialIdea?.id);
  const planningStarted = useRef(false);
  const mountedRef = useRef(true);
  const activeMatterRef = useLatestValue(state.activeMatter);
  const hasMatter = hasSkillIdeaTestMatter(state.activeMatter);

  const [session, setSession] = useState<SkillIdeaSessionState>(() => createInitialSkillIdeaSessionState({
    ideaText,
    startsWithBlankIdea,
    startsFromSavedIdea,
    initialIdea,
  }));

  const safeSetSession = useCallback((updater: SetStateAction<SkillIdeaSessionState>) => {
    if (mountedRef.current) setSession(updater);
  }, []);

  const applyTransition = useCallback((transition: SkillIdeaSessionTransition) => {
    safeSetSession((s) => reduceSkillIdeaSessionState(s, transition));
  }, [safeSetSession]);

  const asyncOperationRef = useRef<{ name: SkillIdeaAsyncOperation | 'idle'; seq: number }>({ name: 'idle', seq: 0 });
  const beginAsyncOperation = useCallback((name: SkillIdeaAsyncOperation) => {
    const seq = asyncOperationRef.current.seq + 1;
    asyncOperationRef.current = { name, seq };
    return {
      isCurrent: () => mountedRef.current
        && asyncOperationRef.current.name === name
        && asyncOperationRef.current.seq === seq,
    };
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    if (startsFromSavedIdea) {
      appendTerminal([`[skill-idea] resumed saved idea — id: ${initialIdea?.id}`]);
      return;
    }
    if (planningStarted.current) return;
    planningStarted.current = true;
    void planInterview();
    async function planInterview() {
      const operation = beginAsyncOperation('plan');
      appendTerminal(['[skill-idea] planning interview…']);
      const startingMatterName = activeMatterRef.current?.name || '';
      try {
        const result = await api.planSkillIdeaInterview({
          userRequest: initialInput,
          skillIdea: { text: ideaText },
          matterName: startingMatterName || undefined,
        });
        if (!operation.isCurrent()) return;
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
        if (!operation.isCurrent()) return;
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
  }, [activeMatterRef, appendTerminal, beginAsyncOperation, ideaText, initialIdea?.id, initialInput, safeSetSession, startsFromSavedIdea]);

  const handleAnswer = useCallback((answer: string) => {
    applyTransition({ type: 'answer_question', answer });
  }, [applyTransition]);

  async function persistCurrentIdea(matterName = selectedSkillIdeaMatterName(activeMatterRef.current)) {
    return persistSkillIdeaSession({ session, matterName });
  }

  async function handleSave() {
    const operation = beginAsyncOperation('save');
    const hadSample = Boolean(session.sample);
    const startingMatterName = selectedSkillIdeaMatterName(activeMatterRef.current);
    applyTransition({ type: 'start_saving' });
    appendTerminal(['[skill-idea] saving idea…']);
    try {
      const { brief, ideaTextForSave, savedIdea, updatingExistingIdea } = await persistCurrentIdea(startingMatterName);
      if (!operation.isCurrent()) return;
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
      if (!operation.isCurrent()) return;
      safeSetSession((s) => ({ ...s, phase: 'ready', error: getErrorMessage(e) }));
    }
  }

  async function handleGenerateSample(feedback = '', previousSample = session.sample?.output || '') {
    const startingMatter = activeMatterRef.current;
    const startingMatterFolder = startingMatter?.folderName || '';
    const startingMatterName = selectedSkillIdeaMatterName(startingMatter);
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
    const operation = beginAsyncOperation('sample');
    const hadSavedIdea = Boolean(session.savedIdeaId && session.savedIdea);
    applyTransition({ type: 'start_sampling' });
    try {
      let savedIdea = session.savedIdea;
      let savedIdeaId = session.savedIdeaId;
      if (!savedIdea || !savedIdeaId || session.answersDirtySinceSave) {
        appendTerminal([session.answersDirtySinceSave ? '[skill-idea] saving updated idea before sample…' : '[skill-idea] saving idea before sample…']);
        const saved = await persistCurrentIdea(startingMatterName);
        if (!operation.isCurrent()) return;
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
        matterName: startingMatterFolder || startingMatterName,
      });
      if (!operation.isCurrent()) return;
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
      if (!operation.isCurrent()) return;
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
    const operation = beginAsyncOperation('create');
    const startingMatterName = selectedSkillIdeaMatterName(activeMatterRef.current);
    applyTransition({ type: 'start_creating' });
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
        onCreating: () => {
          if (operation.isCurrent()) appendTerminal(['[skill-idea] creating skill from approved sample…']);
        },
      });
      if (!operation.isCurrent()) return;
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
      dispatch({ type: 'BUMP_SKILLS_DATA_REFRESH' });
      dispatch({ type: 'SET_TAB', payload: 'skills' });
      dispatch({ type: 'SET_BREADCRUMBS', payload: 'Skills' });
    } catch (e) {
      if (!operation.isCurrent()) return;
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
    applyTransition({ type: 'edit_answers' });
  }

  function handlePickMatterForSample() {
    dispatch({ type: 'SET_TAB', payload: 'home' });
    dispatch({ type: 'SET_VIEW', payload: 'find-matter' });
    dispatch({ type: 'SET_BREADCRUMBS', payload: 'Home' });
    showSessionGuidance('Pick a matter to test this saved skill idea, then continue it from Skills.');
    appendTerminal(['[skill-idea] pick a matter before generating a sample']);
  }

  async function handleMarkReady() {
    if (!session.savedIdeaId) return;
    if (!session.savedIdea?.readiness?.ready) {
      showSessionGuidance('Complete every readiness item before marking ready for review.');
      return;
    }
    const operation = beginAsyncOperation('mark-ready');
    safeSetSession((s) => ({ ...s, notice: null, error: null }));
    try {
      const payload = await api.updateSkillIdeaStatus(session.savedIdeaId, { status: SKILL_IDEA_STATUS.READY_FOR_REVIEW });
      if (!operation.isCurrent()) return;
      appendTerminal([`[skill-idea] marked ready for review — id: ${session.savedIdeaId}`]);
      safeSetSession((s) => ({
        ...s,
        savedIdea: payload.idea || (s.savedIdea ? { ...s.savedIdea, status: SKILL_IDEA_STATUS.READY_FOR_REVIEW } : s.savedIdea),
        notice: 'Marked ready for review. Open Skills to review the saved idea.',
      }));
    } catch (e) {
      if (!operation.isCurrent()) return;
      safeSetSession((s) => ({ ...s, error: getErrorMessage(e) }));
    }
  }

  function setOverlapJustification(overlapJustification: string) {
    applyTransition({ type: 'set_overlap_justification', overlapJustification });
  }

  function parkOverlapGate() {
    applyTransition({ type: 'park_overlap_gate' });
  }

  function closeSession() {
    onInputOverride(null);
    onClose();
  }

  function showSessionGuidance(message: string) {
    applyTransition({ type: 'show_guidance', message });
  }

  function isCurrentMatterName(matterName: string) {
    const currentMatter = activeMatterRef.current;
    return Boolean(matterName)
      && (currentMatter?.name === matterName || currentMatter?.folderName === matterName);
  }

  function sampleMatterChanged(sample: SkillIdeaSessionState['sample']) {
    if (!sample?.matterFolder) return false;
    return (activeMatterRef.current?.folderName || '') !== sample.matterFolder;
  }

  function selectedSkillIdeaMatterName(matter: typeof state.activeMatter): string {
    return matter?.folderName || matter?.name || '';
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
      handlePickMatterForSample,
      handleSave,
      parkOverlapGate,
      setOverlapJustification,
    },
  };
}
