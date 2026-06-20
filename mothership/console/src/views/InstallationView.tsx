import { useCallback, useEffect, useState } from 'react';
import { getInstallationReport, revokeInstallation, updateFeedbackStatus } from '../api/client';
import type { FeedbackStatus, MetricSnapshot, MothershipReport, TriageItem } from '../types';
import { FEEDBACK_STATUSES } from '../types';
import { formatRelative, patienceRiskClass, severityClass, statusClass } from '../lib/format';
import { Score } from '../components/Score';

interface InstallationViewProps {
  installationId: string;
  sinceDays: number;
  userFilter: string;
  onBack: () => void;
  onRevoked: () => void;
}

export function InstallationView({ installationId, sinceDays, userFilter, onBack, onRevoked }: InstallationViewProps) {
  const [report, setReport] = useState<MothershipReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [triageNote, setTriageNote] = useState<Record<string, string>>({});
  const [triageStatus, setTriageStatus] = useState<Record<string, FeedbackStatus>>({});
  const [actionMessage, setActionMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rep = await getInstallationReport(installationId, sinceDays);
      setReport(rep);
      const initialStatus: Record<string, FeedbackStatus> = {};
      for (const item of rep.items) {
        if (item.kind === 'feedback' && isFeedbackStatus(item.status)) initialStatus[item.id] = item.status;
      }
      setTriageStatus(initialStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load installation report.');
    } finally {
      setLoading(false);
    }
  }, [installationId, sinceDays]);

  useEffect(() => { void load(); }, [load]);

  async function handleSubmitTriage(item: TriageItem) {
    setBusy(`triage:${item.id}`);
    setActionMessage('');
    try {
      const status = triageStatus[item.id] || (item.status as FeedbackStatus);
      const note = triageNote[item.id] || '';
      const result = await updateFeedbackStatus(installationId, item.id, status, note);
      if (result.ok) {
        setActionMessage(`Updated ${item.id} to ${status}.`);
        setTriageNote((prev) => ({ ...prev, [item.id]: '' }));
        await load();
      } else {
        setActionMessage(`Could not update ${item.id} (status ${result.status}).`);
      }
    } finally {
      setBusy('');
    }
  }

  async function handleRevoke() {
    if (!confirm(`Revoke installation "${installationId}"? This permanently revokes its ingestion token. In-flight data queues locally on the workbench but will no longer be accepted.`)) return;
    setBusy('revoke');
    setActionMessage('');
    try {
      const result = await revokeInstallation(installationId);
      if (result.ok) {
        setActionMessage(`Revoked installation ${installationId}.`);
        onRevoked();
      } else if (result.status === 404) {
        setActionMessage('Installation was already revoked or not found.');
      } else {
        setActionMessage(`Could not revoke (status ${result.status}).`);
      }
    } finally {
      setBusy('');
    }
  }

  const feedbackItems = (report?.items.filter((item) => item.kind === 'feedback') ?? [])
    .filter((item) => !userFilter || item.user === userFilter);
  const signalItems = report?.items.filter((item) => item.kind === 'signal') ?? [];
  const latest = report?.metrics.latest;
  const snapshots = report?.metrics.snapshots ?? [];
  const heartbeat = report?.heartbeats.latest;
  const journeys = heartbeat?.journeys.filter((j) => !userFilter || j.user === userFilter) ?? [];

  return (
    <section className="view">
      <header className="view-header">
        <div>
          <button className="link-button" onClick={onBack}>← Fleet</button>
          <h2 style={{ marginTop: 4 }}>{installationId}</h2>
          <p className="muted">Last {report?.sinceDays ?? sinceDays} days · generated {formatRelative(report?.generatedAt)}{userFilter ? ` · filtered: ${userFilter}` : ''}</p>
        </div>
        <div className="view-header-actions">
          <button className="secondary" onClick={() => { void load(); }} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="danger" onClick={() => { void handleRevoke(); }} disabled={Boolean(busy)}>
            {busy === 'revoke' ? 'Revoking…' : 'Revoke installation'}
          </button>
        </div>
      </header>

      {actionMessage && <div className="form-info">{actionMessage}</div>}
      {error && <div className="form-error">{error}</div>}

      {latest && (
        <div className="card">
          <h3>Backend & deployment metrics</h3>
          <div className="score-row">
            <Score label="Backend suitability" value={latest.scores?.backendSuitability} />
            <Score label="Portability" value={latest.scores?.portability} />
            <Score label="Restore confidence" value={latest.scores?.restoreConfidence} />
            <Score label="Capacity headroom" value={latest.scores?.capacityHeadroom} />
            <Score label="User patience risk" value={latest.scores?.userPatienceRisk} isText />
            <Score label="P95 latency" value={latencyP95(latest)} suffix="ms" />
            <Score label="Disk free" value={diskFreePercent(latest)} suffix="%" />
          </div>
          {snapshots.length > 1 && (
            <div className="snapshot-timeline">
              <div className="muted small">Recent snapshots</div>
              <div className="sparkline">
                {snapshots.slice(0, 12).map((snap) => (
                  <div key={snap.id} className="spark-bar" title={`${formatRelative(snap.receivedAt)}: ${snap.scores?.backendSuitability ?? '—'}`}>
                    <div className="spark-fill" style={{ height: `${Math.min(100, Math.max(0, Number(snap.scores?.backendSuitability ?? 0)))}%` }} />
                  </div>
                ))}
              </div>
              <div className="muted small">Received {formatRelative(latest.receivedAt)}</div>
            </div>
          )}
        </div>
      )}

      {heartbeat && (
        <div className="card">
          <h3>Heartbeat & journeys</h3>
          <div className="score-row">
            <Score label="Active sessions" value={heartbeat.activeSessions} />
            <Score label="Highest patience risk" value={heartbeat.highestPatienceRisk} isText />
            <Score label="Heartbeat age" value={report?.summary.latestHeartbeatAgeMinutes} suffix="m" />
          </div>
          {journeys.length > 0 && (
            <>
              <h4 className="subheading">Active journeys{userFilter ? ` — ${userFilter}` : ''}</h4>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr><th>User</th><th>Matter</th><th>Stage</th><th>Status</th><th>Patience</th><th>Last error</th></tr>
                  </thead>
                  <tbody>
                    {journeys.map((journey, index) => (
                      <tr key={`${journey.user}-${journey.matter}-${index}`}>
                        <td>{journey.user || '—'}</td>
                        <td>{journey.matter || '—'}</td>
                        <td>{journey.currentStage || journey.lastAction || '—'}</td>
                        <td>{journey.currentStageStatus || '—'}</td>
                        <td><span className={`pill ${patienceRiskClass(journey.patienceRisk)}`}>{journey.patienceRisk}</span></td>
                        <td className="small">{journey.lastError || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {heartbeat.matterHealth.length > 0 && (
            <>
              <h4 className="subheading">Matter health</h4>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr><th>Matter</th><th>Prepare state</th><th>Next step</th><th>Blockers</th><th>Warnings</th></tr>
                  </thead>
                  <tbody>
                    {heartbeat.matterHealth.map((item) => (
                      <tr key={item.matter}>
                        <td><strong>{item.matter}</strong></td>
                        <td>{item.prepareState || '—'}</td>
                        <td>{item.nextStepLabel || '—'}</td>
                        <td>{item.blockers}</td>
                        <td>{item.warnings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <div className="card">
        <h3>Feedback ({feedbackItems.length})</h3>
        {feedbackItems.length ? (
          <ul className="triage-list">
            {feedbackItems.map((item) => (
              <li key={item.id} className="triage-row">
                <div className="triage-head">
                  <span className={`pill ${severityClass(item.severity)}`}>{item.severity}</span>
                  <span className={`pill lane-${item.action_lane}`}>{item.action_lane.replace('_', ' ')}</span>
                  <span className={`pill ${statusClass(item.status)}`}>{item.status}</span>
                  <strong>{item.title}</strong>
                </div>
                {item.detail && <div className="muted small">{item.detail}</div>}
                <div className="muted small">
                  {item.user && !userFilter && <>user: {item.user} · </>}
                  {item.matterName && <>matter: {item.matterName} · </>}
                  received {formatRelative(item.receivedAt)}
                </div>
                {item.triageStatusNote && <div className="muted small">last note: {item.triageStatusNote}</div>}
                <div className="triage-actions">
                  <select
                    value={triageStatus[item.id] ?? item.status}
                    onChange={(event) => setTriageStatus((prev) => ({ ...prev, [item.id]: event.target.value as FeedbackStatus }))}
                  >
                    {FEEDBACK_STATUSES.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Optional note"
                    value={triageNote[item.id] ?? ''}
                    onChange={(event) => setTriageNote((prev) => ({ ...prev, [item.id]: event.target.value }))}
                  />
                  <button
                    onClick={() => { void handleSubmitTriage(item); }}
                    disabled={Boolean(busy)}
                  >
                    {busy === `triage:${item.id}` ? 'Saving…' : 'Update status'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No feedback in this window.</p>
        )}
      </div>

      <div className="card">
        <h3>Signals ({signalItems.length})</h3>
        {signalItems.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr><th>Signal</th><th>Severity</th><th>Occurrences</th><th>First seen</th><th>Last seen</th><th>Detail</th></tr>
              </thead>
              <tbody>
                {signalItems.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.title}</strong><div className="muted small">{item.id}</div></td>
                    <td><span className={`pill ${severityClass(item.severity)}`}>{item.severity}</span></td>
                    <td>{item.occurrenceCount}</td>
                    <td className="small">{formatRelative(item.firstSeenAt)}</td>
                    <td className="small">{formatRelative(item.lastSeenAt || item.receivedAt)}</td>
                    <td className="small">{item.detail || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No signals in this window.</p>
        )}
      </div>
    </section>
  );
}

function latencyP95(snapshot: MetricSnapshot): number | null {
  const value = (snapshot.latency as { p95Ms?: number } | undefined)?.p95Ms;
  return typeof value === 'number' ? value : null;
}

function diskFreePercent(snapshot: MetricSnapshot): number | null {
  const runtime = snapshot.runtime as { diskFreePercent?: number } | undefined;
  const value = runtime?.diskFreePercent;
  return typeof value === 'number' ? value : null;
}

function isFeedbackStatus(value: string): value is FeedbackStatus {
  return (FEEDBACK_STATUSES as readonly string[]).includes(value);
}
