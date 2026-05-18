import { useState, useEffect, useCallback, useRef, type SetStateAction } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import { useLatestValue } from '../../hooks/useLatestValue';
import { writeClipboardText } from '../../lib/clipboard';
import { getErrorMessage } from '../../lib/errors';
import {
  buildSkillCreationOverlapRequest,
  hasSkillCreationOverlapOverride,
  isBlockingSkillOverlapDecision,
} from '../../lib/skillCreationOverlap';
import { classifySkillIdeaSessionInput } from '../../lib/skillIdeaSessionCommands';
import { parseSkillIdeaText } from '../../lib/skillIdeaInput';
import { SKILL_IDEA_STATUS } from '../../lib/skillIdeaStatuses';
import { isSkillSampleStaleState, SKILL_SAMPLE_STATE } from '../../lib/skillSampleStates';
import {
  buildSkillIdeaDesignBrief,
  findSkillIdeaSampleByVersion,
  formatSkillIdeaDesignBrief,
  formatSkillIdeaPlannerTerminalLine,
  formatSkillIdeaReviewPacket,
  formatSkillIdeaSampleCopy,
  hasSkillIdeaTestMatter,
  normalizePlannedSkillIdeaInterview,
  overlapMatchedLabel,
  SIMPLE_SKILL_IDEA_QUESTIONS,
  type InterviewQuestion,
} from '../../lib/skillIdeaSession';
import type { SkillIdea, SkillIdeaDesignBrief, SkillInterviewPlanResponse, SkillRouterDecision, SkillSampleOutputResponse } from '../../types';

interface SessionState {
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
  sample: { id: string; output: string; warnings?: string[]; approved?: boolean; version?: number; state?: string } | null;
  answersDirtySinceSave: boolean;
  overlapGate: { decision: SkillRouterDecision; userRequest: string } | null;
  overlapJustification: string;
  createdSkill: { slash?: string; name?: string } | null;
  notice: string | null;
  error: string | null;
}

interface Props {
  initialInput: string;
  onClose: () => void;
  onInputOverride: (handler: ((input: string) => boolean) | null) => void;
}

export default function SkillIdeaSession({ initialInput, onClose, onInputOverride }: Props) {
  const { state, appendTerminal, dispatch } = useApp();
  const ideaText = parseSkillIdeaText(initialInput) ?? initialInput;
  const planningStarted = useRef(false);
  const mountedRef = useRef(true);
  const activeMatterRef = useLatestValue(state.activeMatter);
  const hasMatter = hasSkillIdeaTestMatter(state.activeMatter);

  const [session, setSession] = useState<SessionState>({
    phase: 'planning',
    ideaText,
    understoodText: ideaText,
    questions: [],
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

  const safeSetSession = useCallback((updater: SetStateAction<SessionState>) => {
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
      try {
        const result = await api.planSkillIdeaInterview({
          userRequest: initialInput,
          skillIdea: { text: ideaText },
          matterName: state.activeMatter?.name,
        });
        const planned = normalizePlannedSkillIdeaInterview(result, ideaText);
        safeSetSession((s) => ({
          ...s,
          phase: planned.questions.length ? 'interviewing' : 'ready',
          understoodText: planned.understoodText,
          questions: planned.questions,
          plannedBrief: planned.designBrief,
          defaultAssumptions: planned.defaultAssumptions,
          riskFlags: planned.riskFlags,
          planner: result.planner,
          error: null,
        }));
        appendTerminal([formatSkillIdeaPlannerTerminalLine(result)]);
      } catch (e) {
        safeSetSession((s) => ({
          ...s,
          phase: 'interviewing',
          questions: SIMPLE_SKILL_IDEA_QUESTIONS,
          planner: null,
          error: `Planner unavailable; using a basic interview. ${getErrorMessage(e)}`,
        }));
        appendTerminal([`[skill-idea] planner unavailable; using basic interview: ${getErrorMessage(e)}`]);
      }
    }
  }, [appendTerminal, ideaText, initialInput, safeSetSession]);

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

  async function persistCurrentIdea() {
    const updatingExistingIdea = Boolean(session.savedIdeaId);
    const brief = buildSkillIdeaDesignBrief(session.ideaText, session.answers, session.plannedBrief, session.questions);
    const result = updatingExistingIdea && session.savedIdeaId
      ? await api.updateSkillIdeaBrief(session.savedIdeaId, { designBrief: brief })
      : await api.createSkillIdea({
        text: session.ideaText,
        designBrief: brief,
        matterName: state.activeMatter?.name,
      });
    return {
      brief,
      savedIdea: result.idea,
      updatingExistingIdea,
    };
  }

  async function handleSave() {
    const hadSample = Boolean(session.sample);
    safeSetSession((s) => ({ ...s, phase: 'saving', notice: null, error: null }));
    appendTerminal(['[skill-idea] saving idea…']);
    try {
      const { brief, savedIdea, updatingExistingIdea } = await persistCurrentIdea();
      safeSetSession((s) => ({
        ...s,
        phase: 'saved',
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
        const saved = await persistCurrentIdea();
        savedIdea = saved.savedIdea;
        savedIdeaId = saved.savedIdea.id;
      }
      appendTerminal([feedback ? '[skill-idea] regenerating sample output…' : '[skill-idea] generating sample output…']);
      const result = await api.generateSampleOutput({
        idea: savedIdea,
        feedback,
        previousSample,
      });
      const latestMatterFolder = activeMatterRef.current?.folderName || '';
      const resultMatterFolder = generatedSampleMatterFolder(result);
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
      const sampleId = result.sample_id || result.storedSample?.id || '';
      const output = result.sample_markdown || result.storedSample?.sampleMarkdown || '';
      safeSetSession((s) => ({
        ...s,
        phase: 'sampled',
        savedIdeaId,
        savedIdea,
        designBrief: savedIdea?.designBrief || s.designBrief,
        answersDirtySinceSave: false,
        sample: sampleId && output
          ? {
              id: sampleId,
              output,
              warnings: result.warnings || result.storedSample?.warnings,
              version: result.storedSample?.version,
              approved: result.storedSample?.approved,
              state: result.storedSample?.state || SKILL_SAMPLE_STATE.CURRENT,
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
    if (!session.savedIdeaId || !session.sample) return;
    if (session.answersDirtySinceSave) {
      showSessionGuidance('Save updates and generate a fresh sample before creating the skill.');
      return;
    }
    if (isSkillSampleStaleState(session.sample.state)) {
      showSessionGuidance('Regenerate the sample after the design brief changes before creating the skill.');
      return;
    }
    safeSetSession((s) => ({ ...s, phase: 'creating', error: null }));
    appendTerminal(['[skill-idea] approving sample and checking skill overlap…']);
    try {
      if (!session.sample.approved) {
        await api.approveSkillIdeaSample(session.savedIdeaId, session.sample.id);
      }
      const overlapCleared = await ensureSkillOverlapCleared(overlapOverrideJustification);
      if (!overlapCleared) return;
      appendTerminal(['[skill-idea] creating skill from approved sample…']);
      const result = await api.createSkillFromIdea(session.savedIdeaId, { overlapOverrideJustification });
      safeSetSession((s) => ({
        ...s,
        phase: 'created',
        overlapGate: null,
        overlapJustification: '',
        sample: s.sample ? { ...s.sample, approved: true } : s.sample,
        createdSkill: result.skill ? { slash: result.skill.slash, name: result.skill.title } : { name: 'New skill' },
      }));
      appendTerminal([`[skill-idea] skill created: ${result.skill?.slash ?? result.skill?.title}`]);
      dispatch({ type: 'SET_TAB', payload: 'skills' });
    } catch (e) {
      safeSetSession((s) => ({ ...s, phase: 'sampled', error: getErrorMessage(e) }));
    }
  }

  async function ensureSkillOverlapCleared(overlapOverrideJustification = '') {
    if (!session.savedIdea) return true;
    const userRequest = buildSkillCreationOverlapRequest(session.savedIdea, session.designBrief || session.savedIdea.designBrief);
    if (!userRequest.trim()) return true;
    const decision = await api.checkIntent({
      userRequest,
      matterName: state.activeMatter?.name,
      overrideJustification: overlapOverrideJustification,
    });
    if (!isBlockingSkillOverlapDecision(decision, overlapOverrideJustification)) return true;
    safeSetSession((s) => ({
      ...s,
      phase: 'sampled',
      sample: s.sample ? { ...s.sample, approved: true } : s.sample,
      overlapGate: { decision, userRequest },
      error: null,
    }));
    appendTerminal([`[skill-idea] existing skill review needed${decision.matched_skill ? `: ${decision.matched_skill}` : ''}`]);
    return false;
  }

  async function handleCopySample() {
    if (!session.sample) return;
    try {
      await writeClipboardText(formatSkillIdeaSampleCopy(session.sample, {
        version: session.sample.version || 1,
        approved: session.sample.approved,
      }));
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
      const payload = await api.getSkillIdeaSamples(session.savedIdeaId);
      const sample = findSkillIdeaSampleByVersion(payload.samples || [], version);
      if (!sample) {
        showSessionGuidance(`Sample v${Number(version || 0) || '?'} is not available in the ledger.`);
        return;
      }
      await writeClipboardText(formatSkillIdeaSampleCopy(sample, {
        version,
        approved: sample.approved,
      }));
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
      const registry = await api.getSkills().catch((error) => {
        appendTerminal([`[skill-idea] copied review packet without registry classification: ${getErrorMessage(error)}`]);
        return null;
      });
      await writeClipboardText(formatSkillIdeaReviewPacket(session.savedIdea, registry));
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

  function showSessionGuidance(message: string) {
    safeSetSession((s) => ({ ...s, notice: message, error: null }));
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
      onInputOverride(null);
      onClose();
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
      onInputOverride(null);
      onClose();
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

  const currentQ = session.phase === 'interviewing' && session.questionIndex < session.questions.length
    ? session.questions[session.questionIndex]
    : null;

  return (
    <div className="skill-idea-session">
      <div className="skill-idea-header">
        <div className="skill-idea-kicker">Skill Factory</div>
        <h3>New skill idea</h3>
        <button type="button" className="skill-idea-close" onClick={() => { onInputOverride(null); onClose(); }} aria-label="Close">
          ×
        </button>
      </div>

      {session.ideaText && (
        <div className="skill-idea-understood">
          <strong>What I understood:</strong> {session.understoodText || session.ideaText}
        </div>
      )}

      {session.phase === 'planning' && (
        <p className="skill-idea-status">Planning the right questions…</p>
      )}

      {session.planner && (
        <p className="skill-idea-q-help">
          {session.planner.used
            ? `Interview planned by ${session.planner.provider || 'configured provider'}${session.planner.model ? ` / ${session.planner.model}` : ''}.`
            : 'Using the safe deterministic interview path.'}
        </p>
      )}

      {session.riskFlags.length > 0 && (
        <ul className="skill-idea-sample-warnings">
          {session.riskFlags.map((flag) => <li key={flag}>{flag}</li>)}
        </ul>
      )}

      {session.notice && (
        <div className="skill-idea-notice">{session.notice}</div>
      )}

      {/* Answered questions */}
      {Object.keys(session.answers).length > 0 && (
        <div className="skill-idea-answers">
          {session.questions.slice(0, session.questionIndex).map((q) => (
            <div key={q.id} className="skill-idea-answer-row">
              <span className="skill-idea-answer-label">{q.label}</span>
              <span className="skill-idea-answer-value">{session.answers[q.id]}</span>
            </div>
          ))}
        </div>
      )}

      {/* Active question */}
      {currentQ && (
        <div className="skill-idea-question">
          <div className="skill-idea-q-label">{currentQ.label}</div>
          {currentQ.help && <p className="skill-idea-q-help">{currentQ.help}</p>}
          {currentQ.examples && currentQ.examples.length > 0 && (
            <div className="skill-idea-q-examples">
              {currentQ.examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="skill-idea-example-chip"
                  onClick={() => handleAnswer(ex)}
                >
                  {ex}
                </button>
              ))}
            </div>
          )}
          <p className="skill-idea-q-hint">Type your answer below, or click an example.</p>
        </div>
      )}

      {/* Ready state */}
      {session.phase === 'ready' && (
        <div className="skill-idea-ready">
          <p>All questions answered. Save this idea to generate a sample output.</p>
          {session.defaultAssumptions.length > 0 && (
            <ul className="skill-idea-sample-warnings">
              {session.defaultAssumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
            </ul>
          )}
          <div className="skill-idea-actions">
            <button type="button" onClick={handleSave}>Save idea</button>
            <button type="button" className="secondary" onClick={handleEditAnswers}>Edit answers</button>
          </div>
        </div>
      )}

      {/* Saving */}
      {session.phase === 'saving' && (
        <p className="skill-idea-status">Saving idea…</p>
      )}

      {/* Saved state */}
      {session.phase === 'saved' && (
        <div className="skill-idea-saved">
          <p>Idea saved. Generate a sample to preview the output before creating the skill.</p>
          {session.designBrief && (
            <details className="skill-idea-brief">
              <summary>Design brief</summary>
              <pre>{formatSkillIdeaDesignBrief(session.designBrief)}</pre>
            </details>
          )}
          <div className="skill-idea-actions">
            <button
              type="button"
              disabled={!hasMatter}
              onClick={() => { void handleGenerateSample(); }}
            >
              {hasMatter ? 'Generate sample' : 'Pick matter to test this skill'}
            </button>
            <button type="button" className="secondary" onClick={handleEditAnswers}>Edit answers</button>
          </div>
        </div>
      )}

      {/* Sampling */}
      {session.phase === 'sampling' && (
        <p className="skill-idea-status">Generating sample output… this may take a moment.</p>
      )}

      {/* Sampled state */}
      {session.phase === 'sampled' && session.sample && (
        <div className="skill-idea-sample">
          <div className="skill-idea-sample-header">
            <strong>Sample output</strong>
            <button
              type="button"
              className="secondary"
              onClick={handleCopySample}
            >
              Copy
            </button>
          </div>
          <pre className="skill-idea-sample-output">{session.sample.output}</pre>
          {session.sample.warnings && session.sample.warnings.length > 0 && (
            <ul className="skill-idea-sample-warnings">
              {session.sample.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
          <div className="skill-idea-actions">
            <button type="button" onClick={() => { void handleApproveSample(); }}>Looks useful - try creating skill</button>
            <button
              type="button"
              className="secondary"
              disabled={!hasMatter}
              onClick={() => { void handleGenerateSample('Regenerate the sample with the current design brief.', session.sample?.output || ''); }}
            >
              {hasMatter ? 'Regenerate sample' : 'Pick matter to regenerate'}
            </button>
          </div>
          {session.overlapGate && (
            <div className="skill-idea-overlap-gate">
              <h4>This may already be covered</h4>
              <p>
                The idea and approved sample are saved. Review whether this should use or improve an existing skill before creating another one.
              </p>
              <dl className="skill-card-meta">
                <div>
                  <dt>Closest match</dt>
                  <dd>{overlapMatchedLabel(session.overlapGate.decision)}</dd>
                </div>
                <div>
                  <dt>Suggested path</dt>
                  <dd>{session.overlapGate.decision.suggested_next_action || 'Use or improve the existing skill unless this needs a different output, audience, or workflow stage.'}</dd>
                </div>
                {session.overlapGate.decision.reason && (
                  <div>
                    <dt>Reason</dt>
                    <dd>{session.overlapGate.decision.reason}</dd>
                  </div>
                )}
              </dl>
              <label className="skill-idea-overlap-label">
                <span>Why should this be a separate custom skill?</span>
                <textarea
                  value={session.overlapJustification}
                  onChange={(e) => safeSetSession((s) => ({ ...s, overlapJustification: e.target.value }))}
                  placeholder="Example: This creates a separate workshop issue review, not a Library chronology."
                  rows={3}
                />
              </label>
              <div className="skill-idea-actions">
                <button
                  type="button"
                  disabled={!hasSkillCreationOverlapOverride(session.overlapJustification)}
                  onClick={() => { void handleApproveSample(session.overlapJustification); }}
                >
                  Create separate skill
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => safeSetSession((s) => ({ ...s, overlapGate: null, overlapJustification: '', error: null }))}
                >
                  Park for later
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Creating */}
      {session.phase === 'creating' && (
        <p className="skill-idea-status">Creating skill…</p>
      )}

      {/* Created */}
      {session.phase === 'created' && (
        <div className="skill-idea-created">
          <p>
            Skill created{session.createdSkill?.slash ? `: ${session.createdSkill.slash}` : ''}. You can find it in the Skills tab.
          </p>
          <div className="skill-idea-actions">
            <button type="button" onClick={() => { onInputOverride(null); onClose(); }}>Done</button>
          </div>
        </div>
      )}

      {session.error && (
        <div className="form-error" style={{ marginTop: 8 }}>{session.error}</div>
      )}
    </div>
  );
}

function markSkillIdeaSampleStale(sample: SessionState['sample']): SessionState['sample'] {
  if (!sample) return null;
  return {
    ...sample,
    approved: false,
    state: sample.approved ? SKILL_SAMPLE_STATE.APPROVED_STALE : SKILL_SAMPLE_STATE.STALE,
  };
}

function generatedSampleMatterFolder(result: SkillSampleOutputResponse): string {
  const storedSample = result.storedSample as { matter?: Record<string, unknown> } | undefined;
  const matter = result.matter || storedSample?.matter || {};
  return String(matter.folder_name || matter.folderName || '').trim();
}
