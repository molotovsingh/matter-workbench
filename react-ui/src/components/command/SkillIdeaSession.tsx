import { hasSkillCreationOverlapOverride } from '../../lib/skillCreationOverlap';
import {
  formatSkillIdeaDesignBrief,
  overlapMatchedLabel,
  skillNameSuggestions,
} from '../../lib/skillIdeaSession';
import {
  formatIntentDiscoveryGuidance,
  formatIntentDiscoveryReason,
} from '../../lib/skillIntentRouting';
import { useSkillIdeaSessionMachine } from '../../hooks/useSkillIdeaSessionMachine';
import type { SkillIdea } from '../../types';

const NO_MATTER_SAMPLE_GUIDANCE_PHASES = new Set(['ready', 'saved', 'sampled']);

interface Props {
  initialInput: string;
  initialIdea?: SkillIdea | null;
  onClose: () => void;
  onInputOverride: (handler: ((input: string) => boolean) | null) => void;
}

export default function SkillIdeaSession({ initialInput, initialIdea = null, onClose, onInputOverride }: Props) {
  const isImprovementSession = /^Improve\s+\//i.test(initialInput.trim());
  const {
    session,
    currentQuestion,
    hasMatter,
    actions,
  } = useSkillIdeaSessionMachine({ initialInput, initialIdea, onClose, onInputOverride });
  const currentQuestionExamples = currentQuestion?.id === 'skillName'
    ? skillNameSuggestions(session.ideaText, session.plannedBrief, session.answers)
    : currentQuestion?.examples;
  const showNoMatterSampleGuidance = !hasMatter && NO_MATTER_SAMPLE_GUIDANCE_PHASES.has(session.phase);
  const sampleWarnings = session.sample ? visibleSkillSampleWarnings(session.sample.warnings) : [];

  return (
    <div className="skill-idea-session">
      <div className="skill-idea-header">
        <div className="skill-idea-kicker">Skill Factory</div>
        <h3>{isImprovementSession ? 'Improve existing skill' : 'New skill idea'}</h3>
        <button type="button" className="skill-idea-close" onClick={actions.closeSession} aria-label="Close">
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

      {session.notice && (
        <div className="skill-idea-notice">{session.notice}</div>
      )}

      {showNoMatterSampleGuidance && (
        <div className="skill-idea-notice">
          You can save this idea now, but pick a matter before generating a sample or creating the skill.
        </div>
      )}

      {Object.keys(session.answers).length > 0 && (
        <div className="skill-idea-answers">
          {session.questions.slice(0, session.questionIndex).map((question) => (
            <div key={question.id} className="skill-idea-answer-row">
              <span className="skill-idea-answer-label">{question.label}</span>
              <span className="skill-idea-answer-value">{session.answers[question.id]}</span>
            </div>
          ))}
        </div>
      )}

      {currentQuestion && (
        <div className="skill-idea-question">
          <div className="skill-idea-q-label">{currentQuestion.label}</div>
          {currentQuestion.help && <p className="skill-idea-q-help">{currentQuestion.help}</p>}
          {currentQuestionExamples && currentQuestionExamples.length > 0 && (
            <div className="skill-idea-q-examples">
              {currentQuestionExamples.map((example) => (
                <button
                  key={example}
                  type="button"
                  className="skill-idea-example-chip"
                  onClick={() => actions.handleAnswer(example)}
                >
                  {example}
                </button>
              ))}
            </div>
          )}
          <p className="skill-idea-q-hint">Type your answer below, or click an example.</p>
        </div>
      )}

      {session.phase === 'ready' && (
        <div className="skill-idea-ready">
          <p>
            {isImprovementSession
              ? 'All questions answered. Save these updates to generate a sample output.'
              : 'All questions answered. Save this idea to generate a sample output.'}
          </p>
          {session.defaultAssumptions.length > 0 && (
            <ul className="skill-idea-sample-warnings">
              {session.defaultAssumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
            </ul>
          )}
          <div className="skill-idea-actions">
            <button type="button" onClick={() => { void actions.handleSave(); }}>
              {isImprovementSession ? 'Save updates' : 'Save idea'}
            </button>
            <button type="button" className="secondary" onClick={actions.handleEditAnswers}>Edit answers</button>
          </div>
        </div>
      )}

      {session.phase === 'saving' && (
        <p className="skill-idea-status">Saving idea…</p>
      )}

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
              onClick={() => {
                if (hasMatter) {
                  void actions.handleGenerateSample();
                } else {
                  actions.handlePickMatterForSample();
                }
              }}
            >
              {hasMatter ? 'Generate sample' : 'Pick matter to test this skill'}
            </button>
            <button type="button" className="secondary" onClick={actions.handleEditAnswers}>Edit answers</button>
          </div>
        </div>
      )}

      {session.phase === 'sampling' && (
        <p className="skill-idea-status">Generating sample output… this may take a moment.</p>
      )}

      {session.phase === 'sampled' && session.sample && (
        <div className="skill-idea-sample">
          <div className="skill-idea-sample-header">
            <strong>Sample output</strong>
            <button
              type="button"
              className="secondary"
              onClick={() => { void actions.handleCopySample(); }}
            >
              Copy
            </button>
          </div>
          <pre className="skill-idea-sample-output">{session.sample.output}</pre>
          {sampleWarnings.length > 0 && (
            <ul className="skill-idea-sample-warnings">
              {sampleWarnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
          <div className="skill-idea-actions">
            <button type="button" onClick={() => { void actions.handleApproveSample(); }}>Looks useful - try creating skill</button>
            <button
              type="button"
              className="secondary"
              disabled={!hasMatter}
              onClick={() => { void actions.handleGenerateSample('Regenerate the sample with the current design brief.', session.sample?.output || ''); }}
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
                  <dd>{formatIntentDiscoveryGuidance(session.overlapGate.decision)}</dd>
                </div>
                {formatIntentDiscoveryReason(session.overlapGate.decision.reason) && (
                  <div>
                    <dt>Reason</dt>
                    <dd>{formatIntentDiscoveryReason(session.overlapGate.decision.reason)}</dd>
                  </div>
                )}
              </dl>
              <label className="skill-idea-overlap-label">
                <span>Why should this be a separate custom skill?</span>
                <textarea
                  value={session.overlapJustification}
                  onChange={(event) => actions.setOverlapJustification(event.target.value)}
                  placeholder="Example: This creates a separate workshop issue review, not a Library chronology."
                  rows={3}
                />
              </label>
              <div className="skill-idea-actions">
                <button
                  type="button"
                  disabled={!hasSkillCreationOverlapOverride(session.overlapJustification)}
                  onClick={() => { void actions.handleApproveSample(session.overlapJustification); }}
                >
                  Create separate skill
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={actions.parkOverlapGate}
                >
                  Park for later
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {session.phase === 'creating' && (
        <p className="skill-idea-status">Creating skill…</p>
      )}

      {session.phase === 'created' && (
        <div className="skill-idea-created">
          <p>
            Skill created{session.createdSkill?.name ? `: ${session.createdSkill.name}` : ''}.
            {' '}It is now in Your Skills. Pick any matter and click Run, or type the shortcut in Matter Assistant.
          </p>
          {session.createdSkill?.slash && (
            <p className="skill-idea-created-shortcut">Shortcut: <code>{session.createdSkill.slash}</code></p>
          )}
          <div className="skill-idea-actions">
            <button type="button" onClick={actions.closeSession}>Done</button>
          </div>
        </div>
      )}

      {session.error && (
        <div className="form-error" style={{ marginTop: 8 }}>{session.error}</div>
      )}
    </div>
  );
}

export function visibleSkillSampleWarnings(warnings: string[] | undefined) {
  return (Array.isArray(warnings) ? warnings : [])
    .map((warning) => String(warning || '').replace(/\s+/g, ' ').trim())
    .filter((warning) => warning && !isInternalContextLimitWarning(warning));
}

function isInternalContextLimitWarning(warning: string) {
  const text = warning.toLowerCase();
  return /\bmax(?:blocks|charsperblock|sources|libraryartifacts)\b/i.test(text)
    || /(omitted|truncated).*(evidence block|source record|source document|library artifact|bounded packet|packet)/i.test(text)
    || /(evidence block|source record|source document|library artifact).*(omitted|truncated)/i.test(text);
}
