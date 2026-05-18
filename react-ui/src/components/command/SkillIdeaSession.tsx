import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import { writeClipboardText } from '../../lib/clipboard';
import { getErrorMessage } from '../../lib/errors';
import type { SkillIdea, SkillIdeaDesignBrief, SkillInterviewPlanResponse, SkillRouterDecision } from '../../types';

interface InterviewQuestion {
  id: string;
  label: string;
  help?: string;
  examples?: string[];
  placeholder?: string;
}

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
  sample: { id: string; output: string; warnings?: string[]; approved?: boolean } | null;
  overlapGate: { decision: SkillRouterDecision; userRequest: string } | null;
  overlapJustification: string;
  createdSkill: { slash?: string; name?: string } | null;
  error: string | null;
}

const SIMPLE_QUESTIONS: InterviewQuestion[] = [
  {
    id: 'output',
    label: 'What should this skill produce?',
    help: 'Describe the output document or artifact.',
    examples: ['A summary table of key dates', 'A limitations letter draft', 'A comparison chart of terms'],
    placeholder: 'e.g. a timeline with key events and sources',
  },
  {
    id: 'input',
    label: 'What inputs does it need?',
    help: 'Describe what source documents or data it reads.',
    examples: ['The extracted documents', 'Source labels and metadata', 'All matter files'],
    placeholder: 'e.g. the extracted documents and source labels',
  },
  {
    id: 'rules',
    label: 'Any special rules or format requirements?',
    help: 'Optional — constraints, sorting, structure, tone.',
    examples: ['Sort chronologically', 'Use formal legal language', 'Include page references'],
    placeholder: 'e.g. sort by date, include source file names',
  },
];

function parseSkillIdeaText(input: string): string | null {
  const patterns = [
    /^create\s+(?:a\s+)?skill\s+(?:to|that|for|which)\s+(.+)/i,
    /^new\s+skill\s+(?:to|that|for|which)\s+(.+)/i,
    /^make\s+(?:a\s+)?skill\s+(?:to|that|for|which)\s+(.+)/i,
    /^build\s+(?:a\s+)?skill\s+(?:to|that|for|which)\s+(.+)/i,
    /^I\s+want\s+(?:a\s+)?skill\s+(?:to|that|for|which)\s+(.+)/i,
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return m[1].trim();
  }
  if (/^(?:new skill|create skill)\s*$/i.test(input.trim())) return '';
  return null;
}

interface Props {
  initialInput: string;
  onClose: () => void;
  onInputOverride: (handler: ((input: string) => boolean) | null) => void;
}

export { parseSkillIdeaText };

export default function SkillIdeaSession({ initialInput, onClose, onInputOverride }: Props) {
  const { state, appendTerminal, dispatch } = useApp();
  const ideaText = parseSkillIdeaText(initialInput) ?? initialInput;
  const planningStarted = useRef(false);

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
    overlapGate: null,
    overlapJustification: '',
    createdSkill: null,
    error: null,
  });

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
        });
        const planned = normalizePlannedInterview(result, ideaText);
        setSession((s) => ({
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
        appendTerminal([formatPlannerTerminalLine(result)]);
      } catch (e) {
        setSession((s) => ({
          ...s,
          phase: 'interviewing',
          questions: SIMPLE_QUESTIONS,
          planner: null,
          error: `Planner unavailable; using a basic interview. ${getErrorMessage(e)}`,
        }));
        appendTerminal([`[skill-idea] planner unavailable; using basic interview: ${getErrorMessage(e)}`]);
      }
    }
  }, [appendTerminal, ideaText, initialInput]);

  const handleAnswer = useCallback((answer: string) => {
    setSession((s) => {
      const q = s.questions[s.questionIndex];
      if (!q) return { ...s, phase: 'ready' };
      const newAnswers = { ...s.answers, [q.id]: answer };
      const nextIndex = s.questionIndex + 1;
      const allDone = nextIndex >= s.questions.length;
      return { ...s, answers: newAnswers, questionIndex: nextIndex, phase: allDone ? 'ready' : 'interviewing' };
    });
  }, []);

  useEffect(() => {
    onInputOverride((input: string) => {
      if (session.phase === 'interviewing') {
        handleAnswer(input);
        return true;
      }
      return false;
    });
  }, [session.phase, handleAnswer, onInputOverride]);

  async function handleSave() {
    setSession((s) => ({ ...s, phase: 'saving', error: null }));
    appendTerminal(['[skill-idea] saving idea…']);
    try {
      const brief = buildDesignBrief(session.ideaText, session.answers, session.plannedBrief, session.questions);
      const result = await api.createSkillIdea({
        text: session.ideaText,
        designBrief: brief,
        matterName: state.activeMatter?.name,
      });
      const savedIdea = result.idea;
      setSession((s) => ({
        ...s,
        phase: 'saved',
        savedIdeaId: savedIdea.id,
        savedIdea,
        designBrief: brief,
      }));
      appendTerminal([`[skill-idea] saved — id: ${savedIdea.id}`]);
    } catch (e) {
      setSession((s) => ({ ...s, phase: 'ready', error: getErrorMessage(e) }));
    }
  }

  async function handleGenerateSample() {
    if (!session.savedIdeaId || !session.savedIdea) return;
    setSession((s) => ({ ...s, phase: 'sampling', error: null }));
    appendTerminal(['[skill-idea] generating sample output…']);
    try {
      const result = await api.generateSampleOutput({
        idea: session.savedIdea,
      });
      const sampleId = result.sample_id || result.storedSample?.id || '';
      const output = result.sample_markdown || result.storedSample?.sampleMarkdown || '';
      setSession((s) => ({
        ...s,
        phase: 'sampled',
        sample: sampleId && output
          ? { id: sampleId, output, warnings: result.warnings || result.storedSample?.warnings }
          : null,
      }));
      appendTerminal(['[skill-idea] sample ready']);
    } catch (e) {
      setSession((s) => ({ ...s, phase: 'saved', error: getErrorMessage(e) }));
    }
  }

  async function handleApproveSample(overlapOverrideJustification = '') {
    if (!session.savedIdeaId || !session.sample) return;
    setSession((s) => ({ ...s, phase: 'creating', error: null }));
    appendTerminal(['[skill-idea] approving sample and checking skill overlap…']);
    try {
      if (!session.sample.approved) {
        await api.approveSkillIdeaSample(session.savedIdeaId, session.sample.id);
      }
      const overlapCleared = await ensureSkillOverlapCleared(overlapOverrideJustification);
      if (!overlapCleared) return;
      appendTerminal(['[skill-idea] creating skill from approved sample…']);
      const result = await api.createSkillFromIdea(session.savedIdeaId, { overlapOverrideJustification });
      setSession((s) => ({
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
      setSession((s) => ({ ...s, phase: 'sampled', error: getErrorMessage(e) }));
    }
  }

  async function ensureSkillOverlapCleared(overlapOverrideJustification = '') {
    if (!session.savedIdea) return true;
    const userRequest = buildSkillCreationOverlapRequest(session.savedIdea, session.designBrief || session.savedIdea.designBrief);
    if (!userRequest.trim()) return true;
    const decision = await api.checkIntent({ userRequest, overrideJustification: overlapOverrideJustification });
    if (!isBlockingSkillOverlapDecision(decision, overlapOverrideJustification)) return true;
    setSession((s) => ({
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
      await writeClipboardText(session.sample.output);
      appendTerminal(['[skill-idea] sample copied']);
      setSession((s) => ({ ...s, error: null }));
    } catch (e) {
      const message = getErrorMessage(e);
      appendTerminal([`[skill-idea] sample copy failed: ${message}`]);
      setSession((s) => ({ ...s, error: `Copy failed: ${message}` }));
    }
  }

  function handleEditAnswers() {
    setSession((s) => ({
      ...s,
      phase: s.questions.length ? 'interviewing' : 'ready',
      questionIndex: 0,
      error: null,
    }));
  }

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
              <pre>{formatDesignBrief(session.designBrief)}</pre>
            </details>
          )}
          <div className="skill-idea-actions">
            <button type="button" onClick={handleGenerateSample}>Generate sample</button>
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
            <button type="button" className="secondary" onClick={handleGenerateSample}>Regenerate sample</button>
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
                  onChange={(e) => setSession((s) => ({ ...s, overlapJustification: e.target.value }))}
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
                  onClick={() => setSession((s) => ({ ...s, overlapGate: null, overlapJustification: '', error: null }))}
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

function buildDesignBrief(
  ideaText: string,
  answers: Record<string, string>,
  plannedBrief: SkillIdeaDesignBrief | null,
  questions: InterviewQuestion[],
): SkillIdeaDesignBrief {
  const answerNotes = formatAnswerNotes(answers, questions);
  const notes = [
    plannedBrief?.notes,
    answerNotes,
  ].filter(Boolean).join('\n');
  return {
    intendedUser: plannedBrief?.intendedUser || 'Lawyer',
    problem: plannedBrief?.problem || ideaText,
    expectedInputs: answers.input || plannedBrief?.expectedInputs || 'Selected matter documents and source labels',
    expectedOutputArtifact: answers.output || plannedBrief?.expectedOutputArtifact || 'Internal matter review note',
    targetLane: plannedBrief?.targetLane || '20_Workshop',
    paidPosture: plannedBrief?.paidPosture || 'paid',
    riskLevel: plannedBrief?.riskLevel || 'medium',
    notes: notes || 'No extra format rules supplied.',
  };
}

function formatDesignBrief(brief: SkillIdeaDesignBrief): string {
  return [
    `Problem: ${brief.problem || ''}`,
    `Expected inputs: ${brief.expectedInputs || ''}`,
    `Expected output: ${brief.expectedOutputArtifact || ''}`,
    `Target lane: ${brief.targetLane || ''}`,
    `Paid posture: ${brief.paidPosture || ''}`,
    `Risk: ${brief.riskLevel || ''}`,
    `Notes: ${brief.notes || ''}`,
  ].join('\n');
}

function normalizePlannedInterview(result: SkillInterviewPlanResponse, fallbackIdeaText: string) {
  const plan = result.plan;
  if (!plan) {
    return {
      understoodText: fallbackIdeaText,
      questions: SIMPLE_QUESTIONS,
      designBrief: null,
      defaultAssumptions: [],
      riskFlags: [],
    };
  }
  const questions = Array.isArray(plan.questions)
    ? plan.questions
      .filter((question) => question?.id && question?.label)
      .map((question) => ({
        id: question.id,
        label: question.label,
        help: question.help,
        examples: Array.isArray(question.examples) ? question.examples : [],
      }))
    : [];
  return {
    understoodText: plan.understood_summary || fallbackIdeaText,
    questions,
    designBrief: plan.inferred_design_brief || null,
    defaultAssumptions: Array.isArray(plan.default_assumptions) ? plan.default_assumptions : [],
    riskFlags: Array.isArray(plan.risk_flags) ? plan.risk_flags : [],
  };
}

function formatPlannerTerminalLine(result: SkillInterviewPlanResponse): string {
  if (result.planner?.used) {
    return `[skill-idea] model-planned interview ready: ${result.planner.provider || 'provider'} ${result.planner.model || ''}`.trim();
  }
  return `[skill-idea] basic interview ready${result.planner?.reason ? `: ${result.planner.reason}` : ''}`;
}

function formatAnswerNotes(answers: Record<string, string>, questions: InterviewQuestion[]): string {
  const byId = new Map(questions.map((question) => [question.id, question.label]));
  return Object.entries(answers)
    .filter(([, value]) => value.trim())
    .map(([id, value]) => `${byId.get(id) || id}: ${value.trim()}`)
    .join('\n');
}

function buildSkillCreationOverlapRequest(idea: SkillIdea, brief: SkillIdeaDesignBrief | undefined): string {
  return [
    idea.text,
    brief?.problem ? `Problem: ${brief.problem}` : '',
    brief?.expectedInputs ? `Inputs: ${brief.expectedInputs}` : '',
    brief?.expectedOutputArtifact ? `Output: ${brief.expectedOutputArtifact}` : '',
    brief?.targetLane ? `Lane: ${brief.targetLane}` : '',
  ].filter(Boolean).join('\n');
}

function isBlockingSkillOverlapDecision(decision: SkillRouterDecision, overlapOverrideJustification = ''): boolean {
  if (hasSkillCreationOverlapOverride(overlapOverrideJustification)) return false;
  return Boolean(
    decision.user_gate_required
    || decision.mece_violation
    || decision.decision === 'needs_user_approval'
    || decision.recommended_action === 'modify_existing_skill'
    || (decision.matched_skill && decision.recommended_action === 'run_existing_skill'),
  );
}

function hasSkillCreationOverlapOverride(overlapOverrideJustification = ''): boolean {
  return overlapOverrideJustification.replace(/\s+/g, ' ').trim().length >= 12;
}

function overlapMatchedLabel(decision: SkillRouterDecision): string {
  const matched = decision.matched_skill || '';
  const title = decision.matched_skill_card?.title || decision.matched_skill_card?.display?.action || matched;
  return [title, matched && matched !== title ? matched : ''].filter(Boolean).join(' ');
}
