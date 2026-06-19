import type { SystemHealthReport } from '../../types';

type RuntimeStorageMode = 'filesystem' | 'postgres';

type SystemHealthPanelProps = {
  systemHealth: SystemHealthReport | null;
  systemHealthError: string;
  runtimeStorageMode: RuntimeStorageMode;
};

export function systemHealthNeedsAttention(systemHealth: SystemHealthReport | null) {
  return systemHealth?.status === 'warning' || systemHealth?.status === 'error';
}

export function SystemHealthPanel({ systemHealth, systemHealthError, runtimeStorageMode }: SystemHealthPanelProps) {
  const needsAttention = systemHealthNeedsAttention(systemHealth);

  return (
    <div className="settings-section">
      <h2>System Health</h2>
      <div className="settings-card" style={{ display: 'grid', gap: 12 }}>
        {systemHealth ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <strong>{needsAttention ? 'System health needs attention' : 'All systems ready'}</strong>
                <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                  {systemHealth.summary?.checks ?? systemHealth.checks.length} read-only checks · {systemHealth.runtime?.storageMode || runtimeStorageMode} storage
                </div>
              </div>
              <span className={`provider-status ${systemHealth.status === 'ok' ? 'ready' : 'needs-setup'}`}>
                {systemHealth.status === 'ok' ? 'Ready' : systemHealth.status === 'error' ? 'Errors' : 'Warnings'}
              </span>
            </div>
            {systemHealth.recommendations && systemHealth.recommendations.length > 0 && (
              <ul className="skill-idea-sample-warnings" style={{ margin: 0 }}>
                {systemHealth.recommendations.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
            <details>
              <summary style={{ cursor: 'pointer' }}>Technical health checks</summary>
              <div className="table-scroll" style={{ marginTop: 12 }}>
                <table className="extract-table">
                  <thead>
                    <tr>
                      <th>Check</th>
                      <th>Area</th>
                      <th>Status</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {systemHealth.checks.map((check) => (
                      <tr key={check.id}>
                        <td>{check.label}</td>
                        <td>{check.category}</td>
                        <td>
                          <span className={`provider-status ${check.status === 'ok' ? 'ready' : 'needs-setup'}`}>
                            {check.status}
                          </span>
                        </td>
                        <td>{check.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ) : (
          <div>
            <strong>System health unavailable</strong>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              {systemHealthError || 'Loading read-only system checks…'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
