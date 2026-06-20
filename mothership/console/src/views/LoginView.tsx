import { useState, type FormEvent } from 'react';
import { login } from '../api/client';

interface LoginViewProps {
  onLoggedIn: () => void;
  initialError?: string;
}

export function LoginView({ onLoggedIn, initialError }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError || '');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await login(username, password);
      if (result.ok) {
        onLoggedIn();
        return;
      }
      setError(result.error || (result.status === 429 ? 'Too many attempts. Try again shortly.' : 'Invalid username or password.'));
    } catch {
      setError('Could not reach the mothership. Check it is running and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={(event) => { void handleSubmit(event); }}>
        <div className="login-kicker">Mothership Console</div>
        <h1>Sign in</h1>
        <p className="muted">Operator access to the Matter Workbench fleet dashboard.</p>
        <label>
          <span>Username</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button type="submit" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
