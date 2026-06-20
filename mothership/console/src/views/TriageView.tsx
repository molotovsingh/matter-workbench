import { useMemo, useState } from 'react';
import type { FeedbackStatus, MothershipReport, TriageItem } from '../types';
import { FEEDBACK_STATUSES } from '../types';
import { updateFeedbackStatus } from '../api/client';
import { formatRelative, severityClass, statusClass } from '../lib/format';

interface TriageViewProps {
  report: MothershipReport;
  loading: boolean;
  userFilter: string;
  onOpenInstallation: (installationId: string) => void;
  onChanged: () => void;
}

const ACTION_LANES = ['fix_now', 'investigate', 'product_decision', 'watch'] as const;
const SEVERITIES = ['blocker', 'error', 'warning', 'info'] as const;

export function TriageView({ report, loading, userFilter, onOpenInstallation, onChanged }: TriageViewProps) {
  const [laneFilter, setLaneFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<Record<string, string>>({});
  const [statusOverride, setStatusOverride] = useState<Record<string, FeedbackStatus>>({});
  const [actionMessage, setActionMessage] = useState('');

  const filtered = useMemo(() => {
    return report.items.filter((item) => {
      if (userFilter && item.user !== userFilter) return false;
      if (laneFilter && item.action_lane !== laneFilter) return false;
      if (severityFilter && item.severity !== severityFilter) return false;
      if (statusFilter && (item.kind !== 'feedback' || item.status !== statusFilter)) return false;
      return true;
    });
  }, [report.items, userFilter, laneFilter, severityFilter, statusFilter]);

  function triageFormKey(item: TriageItem) {
    return `${item.installationId || 'fleet'}:${item.id}`;
  }

  async function handleSubmitTriage(item: TriageItem) {
    if (!item.installationId) return;
    const formKey = triageFormKey(item);
    setBusy(`triage:${formKey}`);
    setActionMessage('');
    try {
      const newStatus = statusOverride[formKey] || (item.status as FeedbackStatus);
      const result = await updateFeedbackStatus(item.installationId, item.id, newStatus, note[formKey] || '');
      if (result.ok) {
        setNote((prev) => ({ ...prev, [formKey]: '' }));
        setActionMessage(`Updated ${item.id} to ${newStatus}.`);
        onChanged();
      } else {
        setActionMessage(`Could not update ${item.id} (status ${result.status}).`);
      }
    } catch {
      setActionMessage(`Could not update ${item.id}.`);
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="view">
      <header className="view-header">
        <div>
          <h2>Triage</h2>
          <p className="muted">{filtered.length} of {report.items.length} items · last {report.sinceDays} days</p>
        </div>
      </header>

      {actionMessage && <div className="form-info">{actionMessage}</div>}

      <div className="filter-row">
        <label>
          <span className="muted small">Action lane</span>
          <select value={laneFilter} onChange={(event) => setLaneFilter(event.target.value)}>
            <option value="">All lanes</option>
            {ACTION_LANES.map((lane) => (
              <option key={lane} value={lane}>{lane.replace('_', ' ')}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="muted small">Severity</span>
          <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
            <option value="">All severities</option>
            {SEVERITIES.map((sev) => (
              <option key={sev} value={sev}>{sev}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="muted small">Feedback status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">All statuses</option>
            {FEEDBACK_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </label>
        {(laneFilter || severityFilter || statusFilter) && (
          <button className="link-button" onClick={() => { setLaneFilter(''); setSeverityFilter(''); setStatusFilter(''); }}>
            Clear filters
          </button>
        )}
      </div>

      {loading && !report.items.length ? (
        <p className="muted">Loading triage…</p>
      ) : filtered.length ? (
        <ul className="triage-list">
          {filtered.map((item) => {
            const formKey = triageFormKey(item);
            return (
              <li key={formKey} className="triage-row">
                <div className="triage-head">
                  <span className={`pill ${severityClass(item.severity)}`}>{item.severity}</span>
                  <span className={`pill lane-${item.action_lane}`}>{item.action_lane.replace('_', ' ')}</span>
                  {item.kind === 'feedback' && (
                    <span className={`pill ${statusClass(item.status)}`}>{item.status}</span>
                  )}
                  <span className="muted small">{item.kind}</span>
                  <strong>{item.title}</strong>
                </div>
                {item.detail && <div className="muted small">{item.detail}</div>}
                <div className="muted small">
                  {item.installationId && (
                    <button className="link-button" onClick={() => onOpenInstallation(item.installationId!)}>
                      {item.installationId}
                    </button>
                  )}
                  {item.user && !userFilter && <> · {item.user}</>}
                  {item.matterName && <> · {item.matterName}</>}
                  {' · '}{formatRelative(item.receivedAt)}
                  {item.occurrenceCount > 1 && <> · ×{item.occurrenceCount}</>}
                </div>
                {item.recommended_action && (
                  <div className="muted small">next: {item.recommended_action}</div>
                )}
                {item.triageStatusNote && (
                  <div className="muted small">last note: {item.triageStatusNote}</div>
                )}
                {item.kind === 'feedback' && item.installationId && (
                  <div className="triage-actions">
                    <select
                      value={statusOverride[formKey] ?? item.status}
                      onChange={(event) => setStatusOverride((prev) => ({ ...prev, [formKey]: event.target.value as FeedbackStatus }))}
                    >
                      {FEEDBACK_STATUSES.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Optional note"
                      value={note[formKey] ?? ''}
                      onChange={(event) => setNote((prev) => ({ ...prev, [formKey]: event.target.value }))}
                    />
                    <button
                      onClick={() => { void handleSubmitTriage(item); }}
                      disabled={Boolean(busy)}
                    >
                      {busy === `triage:${formKey}` ? 'Saving…' : 'Update status'}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">No items match these filters.</p>
      )}
    </section>
  );
}
