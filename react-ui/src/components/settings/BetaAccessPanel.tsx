import type { FormEventHandler } from 'react';
import type { PrivateBetaUser } from '../../types';

type BetaAccessPanelProps = {
  users: PrivateBetaUser[];
  error: string;
  loading: boolean;
  actionBusy: string;
  newTesterEmail: string;
  newTesterName: string;
  temporaryPasswordNotice: string;
  onNewTesterEmailChange: (value: string) => void;
  onNewTesterNameChange: (value: string) => void;
  onCreateTester: FormEventHandler<HTMLFormElement>;
  onResetTesterPassword: (username: string) => void;
  onSetTesterDisabled: (username: string, disabled: boolean) => void;
};

export function BetaAccessPanel({
  users,
  error,
  loading,
  actionBusy,
  newTesterEmail,
  newTesterName,
  temporaryPasswordNotice,
  onNewTesterEmailChange,
  onNewTesterNameChange,
  onCreateTester,
  onResetTesterPassword,
  onSetTesterDisabled,
}: BetaAccessPanelProps) {
  return (
    <div className="settings-section">
      <h2>Beta access</h2>
      <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
        Add or remove access for private beta testers. Temporary passwords are shown once after add or reset.
      </p>
      <div className="settings-card" style={{ display: 'grid', gap: 16 }}>
        <form onSubmit={onCreateTester} style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr auto', gap: 10, alignItems: 'end' }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="settings-label">Tester email</span>
              <input
                type="email"
                value={newTesterEmail}
                onChange={(event) => onNewTesterEmailChange(event.target.value)}
                placeholder="name@example.com"
                className="settings-input"
                required
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="settings-label">Display name</span>
              <input
                type="text"
                value={newTesterName}
                onChange={(event) => onNewTesterNameChange(event.target.value)}
                placeholder="Optional"
                className="settings-input"
              />
            </label>
            <button type="submit" disabled={Boolean(actionBusy)}>
              {actionBusy.startsWith('create:') ? 'Adding…' : 'Add tester'}
            </button>
          </div>
        </form>

        {temporaryPasswordNotice && (
          <div className="form-info" style={{ userSelect: 'text' }}>
            {temporaryPasswordNotice}
          </div>
        )}
        {error && <div className="form-warning">{error}</div>}

        <div className="table-scroll">
          <table className="extract-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isBusy = actionBusy.endsWith(`:${user.username}`);
                const isProtectedSuperuser = user.role === 'superuser' && !user.disabled;
                return (
                  <tr key={user.username}>
                    <td>
                      <strong>{user.displayName || user.username}</strong>
                      {user.displayName && <div className="muted" style={{ fontSize: 12 }}>{user.username}</div>}
                    </td>
                    <td>{user.role}</td>
                    <td>
                      <span className={`provider-status ${user.disabled ? 'needs-setup' : 'ready'}`}>
                        {user.disabled ? 'Access removed' : 'Active'}
                      </span>
                    </td>
                    <td>
                      <div className="form-actions" style={{ marginTop: 0 }}>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => onResetTesterPassword(user.username)}
                          disabled={Boolean(actionBusy) || user.disabled}
                        >
                          {isBusy && actionBusy.startsWith('reset:') ? 'Resetting…' : 'Reset password'}
                        </button>
                        {user.disabled ? (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => onSetTesterDisabled(user.username, false)}
                            disabled={Boolean(actionBusy)}
                          >
                            {isBusy && actionBusy.startsWith('enable:') ? 'Restoring…' : 'Restore access'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => onSetTesterDisabled(user.username, true)}
                            disabled={Boolean(actionBusy) || isProtectedSuperuser}
                            title={isProtectedSuperuser ? 'The active superuser account cannot be removed here.' : undefined}
                          >
                            {isBusy && actionBusy.startsWith('disable:') ? 'Removing…' : 'Remove access'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!users.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    {loading ? 'Loading beta testers…' : 'No beta testers configured.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
