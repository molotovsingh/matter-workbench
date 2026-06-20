import { useMemo } from 'react';
import type { InstallationsResponse, MothershipReport } from '../types';
import { formatRelative, severityClass, statusClass } from '../lib/format';
import { Score } from '../components/Score';

interface FleetViewProps {
  installations: InstallationsResponse;
  report: MothershipReport;
  loading: boolean;
  error: string;
  userFilter: string;
  onOpenInstallation: (installationId: string) => void;
}

export function FleetView({ installations, report, loading, error, userFilter, onOpenInstallation }: FleetViewProps) {
  const summary = report.summary;
  const latest = report.metrics.latest;

  const filteredItems = useMemo(() => {
    if (!userFilter) return report.items;
    return report.items.filter((item) => item.user === userFilter);
  }, [report.items, userFilter]);

  const userLabel = userFilter ? ` · filtered: ${userFilter}` : '';

  return (
    <section className="view">
      <header className="view-header">
        <div>
          <h2>Fleet health</h2>
          <p className="muted">Last {report.sinceDays} days · generated {formatRelative(report.generatedAt)}{userLabel}</p>
        </div>
      </header>

      <div className="tile-row">
        <Tile label="Active installs" value={countByStatus(installations.installations, 'active')} accent={statusClass('active')} />
        <Tile label="Revoked" value={countByStatus(installations.installations, 'revoked')} accent={statusClass('revoked')} />
        <Tile label="Silent installs" value={userFilter ? 0 : (summary.silentInstallations ?? 0)} accent="warn" />
        <Tile label="Critical signals" value={userFilter ? filteredItems.filter((i) => i.kind === 'signal' && (i.severity === 'error' || i.severity === 'blocker')).length : summary.criticalSignals} accent="warn" />
        <Tile label="Repeated warnings" value={userFilter ? filteredItems.filter((i) => i.kind === 'signal' && i.occurrenceCount > 1).length : summary.repeatedWarnings} accent="warn" />
        <Tile label="Tester bugs" value={userFilter ? filteredItems.filter((i) => i.kind === 'feedback' && i.category === 'bug').length : summary.bugs} accent="warn" />
        <Tile label="Confusing UX" value={userFilter ? filteredItems.filter((i) => i.kind === 'feedback' && i.category === 'confusing_ux').length : summary.confusingUx} accent="warn" />
        <Tile label="Feature requests" value={userFilter ? filteredItems.filter((i) => i.kind === 'feedback' && i.category === 'feature_request').length : summary.featureRequests} accent="neutral" />
      </div>

      {(latest || summary.latestUserPatienceRisk) && !userFilter && (
        <div className="card">
          <h3>Latest fleet scores</h3>
          <div className="score-row">
            <Score label="Backend suitability" value={latest?.scores?.backendSuitability} />
            <Score label="Portability" value={latest?.scores?.portability} />
            <Score label="Restore confidence" value={latest?.scores?.restoreConfidence} />
            <Score label="Capacity headroom" value={latest?.scores?.capacityHeadroom} />
            <Score label="User patience risk" value={summary.latestUserPatienceRisk} isText />
            <Score label="Heartbeat age" value={summary.latestHeartbeatAgeMinutes} suffix="m" />
          </div>
        </div>
      )}

      <div className="card">
        <h3>Installations</h3>
        {error ? (
          <div className="form-error">{error}</div>
        ) : loading && !installations.installations.length ? (
          <p className="muted">Loading installations…</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Installation</th>
                  <th>Status</th>
                  <th>Last heartbeat</th>
                  <th>Recent signals</th>
                  <th>Recent feedback</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {installations.installations.map((row) => (
                  <tr key={row.installationId}>
                    <td>
                      <strong>{row.label || row.installationId}</strong>
                      <div className="muted small">{row.installationId}</div>
                    </td>
                    <td>
                      <span className={`pill ${statusClass(row.status)}`}>{row.status}</span>
                    </td>
                    <td>
                      {row.latestHeartbeatReceivedAt ? (
                        <span title={row.latestHeartbeatReceivedAt}>{formatRelative(row.latestHeartbeatReceivedAt)}</span>
                      ) : (
                        <span className="muted">never</span>
                      )}
                    </td>
                    <td>{row.recentSignalCount}</td>
                    <td>{row.recentFeedbackCount}</td>
                    <td>
                      <button className="link-button" onClick={() => onOpenInstallation(row.installationId)}>
                        Open →
                      </button>
                    </td>
                  </tr>
                ))}
                {!installations.installations.length && (
                  <tr>
                    <td colSpan={6} className="muted">No installations registered.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Top problems{userFilter ? ` — ${userFilter}` : ''}</h3>
        {filteredItems.length ? (
          <ul className="problem-list">
            {filteredItems.slice(0, 12).map((item) => (
              <li key={item.id}>
                <div className="problem-row">
                  <span className={`pill ${severityClass(item.severity)}`}>{item.severity}</span>
                  <span className={`pill lane-${item.action_lane}`}>{item.action_lane.replace('_', ' ')}</span>
                  <strong>{item.title}</strong>
                  {item.occurrenceCount > 1 && <span className="muted small">×{item.occurrenceCount}</span>}
                </div>
                {item.detail && <div className="muted small problem-sample">{item.detail}</div>}
                <div className="muted small">
                  {item.user && !userFilter && <>user: {item.user} · </>}
                  {item.matterName && <>matter: {item.matterName}</>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{userFilter ? `No problems for ${userFilter} in this window.` : 'No open problems in this window.'}</p>
        )}
      </div>
    </section>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className={`tile ${accent}`}>
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}

function countByStatus(rows: InstallationsResponse['installations'], status: string): number {
  return rows.filter((row) => row.status === status).length;
}
