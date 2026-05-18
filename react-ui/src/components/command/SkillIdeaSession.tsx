import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../store/AppContext';
import { api } from '../../api/client';
import type { SkillIdea, SkillIdeaDesignBrief } from '../../types';

interface InterviewQuestion {
  id: string;
  label: string;
  help?: string;
  examples?: string[];
  placeholder?: string;
}

interface SessionState {
  phase: 'interviewing' | 'ready' | 'saving' | 'saved' | 'sampling' | 'sampled' | 'creating' | 'created';
  ideaText: string;
  questions: InterviewQuestion[];
  answers: Record<string, string>;
  questionIndex: number;
  savedIdeaId: string | null;
  savedIdea: SkillIdea | null;
  designBrief: SkillIdeaDesignBrief | null;
  sample: { id: string; output: string; warnings?: string[] } | null;
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

  const [session, setSession] = useState<SessionState>({
    phase: 'interviewing',
    ideaText,
    questions: SIMPLE_QUESTIONS,
    answers: {},
    questionIndex: 0,
    savedIdeaId: null,
    savedIdea: null,
    designBrief: null,
    sample: null,
    createdSkill: null,
    error: null,
  });

  const handleAnswer = useCallback((answer: string) => {
    setSession((s) => {
      const q = s.questions[s.questionIndex];
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
      const brief = buildDesignBrief(session.ideaText, session.answers);
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
      setSession((s) => ({ ...s, phase: 'ready', error: (e as Error).message }));
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
      setSession((s) => ({ ...s, phase: 'saved', error: (e as Error).message }));
    }
  }

  async function handleApproveSample() {
    if (!session.savedIdeaId || !session.sample) return;
    setSession((s) => ({ ...s, phase: 'creating', error: null }));
    appendTerminal(['[skill-idea] approving sample & creating skill…']);
    try {
      await api.approveSkillIdeaSample(session.savedIdeaId, session.sample.id);
      const result = await api.createSkillFromIdea(session.savedIdeaId);
      setSession((s) => ({
        ...s,
        phase: 'created',
        createdSkill: result.skill ? { slash: result.skill.slash, name: result.skill.title } : { name: 'New skill' },
      }));
      appendTerminal([`[skill-idea] skill created: ${result.skill?.slash ?? result.skill?.title}`]);
      dispatch({ type: 'SET_TAB', payload: 'skills' });
    } catch (e) {
      setSession((s) => ({ ...s, phase: 'sampled', error: (e as Error).message }));
    }
  }

  function handleEditAnswers() {
    setSession((s) => ({
      ...s,
      phase: 'interviewing',
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
          <strong>What I understood:</strong> {session.ideaText}
        </div>
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
              onClick={() => navigator.clipboard.writeText(session.sample!.output).catch(() => null)}
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
            <button type="button" onClick={handleApproveSample}>Approve & create skill</button>
            <button type="button" className="secondary" onClick={handleGenerateSample}>Regenerate sample</button>
          </div>
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

function buildDesignBrief(ideaText: string, answers: Record<string, string>): SkillIdeaDesignBrief {
  return {
    intendedUser: 'Lawyer',
    problem: ideaText,
    expectedInputs: answers.input || 'Selected matter documents and source labels',
    expectedOutputArtifact: answers.output || 'Internal matter review note',
    targetLane: '20_Workshop',
    paidPosture: 'paid',
    riskLevel: 'medium',
    notes: answers.rules || 'No extra format rules supplied.',
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
