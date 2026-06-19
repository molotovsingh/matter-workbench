import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { useApp } from '../../store/AppContext';
import { latestCompactActivityRows } from '../../lib/activityLog';
import { getErrorMessage } from '../../lib/errors';
import { buildPrivateBetaFeedbackDraft } from '../../lib/privateBetaFeedback';
import type { PrivateBetaFeedbackChoice } from '../../types';

interface FeedbackProviderRoute {
  task: string;
  provider: string;
  model: string;
}

interface Props {
  order?: number;
  providerRoutes?: FeedbackProviderRoute[];
}

export default function PrivateBetaFeedbackPanel({ order = 10, providerRoutes = [] }: Props) {
  const { state, appendTerminal } = useApp();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackChoice, setFeedbackChoice] = useState<PrivateBetaFeedbackChoice | ''>('');
  const [feedbackTryingToDo, setFeedbackTryingToDo] = useState('');
  const [feedbackHappenedInstead, setFeedbackHappenedInstead] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const activityRows = latestCompactActivityRows(state.activityLines);
  const feedbackDraft = buildPrivateBetaFeedbackDraft({
    choice: feedbackChoice,
    tryingToDo: feedbackTryingToDo,
    happenedInstead: feedbackHappenedInstead,
  });
  const canSubmitFeedback = Boolean(feedbackDraft) && !feedbackSubmitting;

  async function handleSubmitFeedback(e: FormEvent) {
    e.preventDefault();
    const draft = buildPrivateBetaFeedbackDraft({
      choice: feedbackChoice,
      tryingToDo: feedbackTryingToDo,
      happenedInstead: feedbackHappenedInstead,
    });
    if (!draft || feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    setFeedbackMessage('');
    try {
      await api.submitPrivateBetaFeedback({
        ...draft,
        matterName: state.activeMatter?.name,
        context: {
          screen: state.activeTab,
          currentView: state.activeView,
          route: typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '',
          activeMatterName: state.activeMatter?.name,
          activeMatterFolder: state.activeMatter?.folderName,
          runtimeMode: state.config?.runtimeStorageMode || 'filesystem',
          viewport: viewportLabel(),
          recentActivity: activityRows.map((row) => `${row.time} ${row.message}`),
          providerRoutes,
          visibleError: feedbackHappenedInstead,
        },
      });
      setFeedbackChoice('');
      setFeedbackTryingToDo('');
      setFeedbackHappenedInstead('');
      setFeedbackMessage('');
      setFeedbackOpen(false);
      appendTerminal(['[feedback] saved private beta feedback']);
    } catch (error) {
      setFeedbackMessage(`Could not save feedback: ${getErrorMessage(error)}`);
      appendTerminal([`[feedback] save failed: ${getErrorMessage(error)}`]);
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  return (
    <div className="beta-feedback-entry" style={{ order }}>
      {!feedbackOpen ? (
        <button
          type="button"
          className="secondary beta-feedback-open"
          onClick={() => {
            setFeedbackOpen(true);
            setFeedbackMessage('');
          }}
        >
          Have a problem? Tell us what happened
        </button>
      ) : (
        <form className="beta-feedback-form" onSubmit={handleSubmitFeedback}>
          <div className="beta-feedback-header">
            <strong>Tell us what happened</strong>
            <button
              type="button"
              className="skill-idea-close"
              aria-label="Close feedback"
              onClick={() => {
                setFeedbackOpen(false);
                setFeedbackMessage('');
              }}
            >
              ×
            </button>
          </div>
          <div className="beta-feedback-choice-grid" role="group" aria-label="What happened">
            <span>Optional: pick the closest type.</span>
            {[
              ['did_not_work', 'Something did not work'],
              ['confused', 'I got confused'],
              ['want_something', 'I want a new feature'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={feedbackChoice === value ? 'active' : ''}
                onClick={() => setFeedbackChoice(value as PrivateBetaFeedbackChoice)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="beta-feedback-label">
            <span>What happened? One sentence is enough.</span>
            <textarea
              value={feedbackHappenedInstead}
              onChange={(event) => setFeedbackHappenedInstead(event.target.value)}
              rows={3}
            />
          </label>
          <label className="beta-feedback-label">
            <span>What were you trying to do? Optional.</span>
            <textarea
              value={feedbackTryingToDo}
              onChange={(event) => setFeedbackTryingToDo(event.target.value)}
              rows={3}
            />
          </label>
          <div className="beta-feedback-actions">
            <button type="submit" disabled={!canSubmitFeedback}>
              {feedbackSubmitting ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setFeedbackOpen(false);
                setFeedbackMessage('');
              }}
            >
              Cancel
            </button>
          </div>
          {feedbackMessage && <p className="beta-feedback-message">{feedbackMessage}</p>}
        </form>
      )}
    </div>
  );
}

function viewportLabel() {
  if (typeof window === 'undefined') return '';
  const width = window.innerWidth || 0;
  if (width <= 700) return 'narrow';
  if (width <= 1100) return 'medium';
  return 'desktop';
}
