import { useState, type FormEvent } from 'react';
import { login, requestLoginCode, verifyLoginCode } from '../api/client';
import type { AuthStatus } from '../types';

interface LoginViewProps {
  onLoggedIn: () => void;
  initialError?: string;
  authMode?: AuthStatus['authMode'];
}

export function LoginView({ onLoggedIn, initialError, authMode = 'password' }: LoginViewProps) {
  if (authMode === 'email_code') {
    return <EmailCodeLoginView onLoggedIn={onLoggedIn} initialError={initialError} />;
  }
  return <PasswordLoginView onLoggedIn={onLoggedIn} initialError={initialError} />;
}

function PasswordLoginView({ onLoggedIn, initialError }: Omit<LoginViewProps, 'authMode'>) {
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

function EmailCodeLoginView({ onLoggedIn, initialError }: Omit<LoginViewProps, 'authMode'>) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeRequested, setCodeRequested] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(initialError || '');
  const [busy, setBusy] = useState(false);

  async function handleRequestCode(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await requestLoginCode(email);
      if (result.ok) {
        setCodeRequested(true);
        setNotice(result.message || 'If this email is allowed, a console code has been sent.');
        return;
      }
      setError(result.error || (result.status === 429 ? 'Too many code requests. Try again shortly.' : 'Could not send a code.'));
    } catch {
      setError('Could not reach the mothership. Check it is running and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyCode(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await verifyLoginCode(email, code);
      if (result.ok) {
        onLoggedIn();
        return;
      }
      setError(result.error || (result.status === 429 ? 'Too many attempts. Try again shortly.' : 'Invalid or expired code.'));
    } catch {
      setError('Could not reach the mothership. Check it is running and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={(event) => { void (codeRequested ? handleVerifyCode(event) : handleRequestCode(event)); }}>
        <div className="login-kicker">Mothership Console</div>
        <h1>Email code sign in</h1>
        <p className="muted">Enter an allowed operator email. We’ll send a one-time code.</p>
        <label>
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setCodeRequested(false);
              setCode('');
              setNotice('');
            }}
            required
          />
        </label>
        {codeRequested && (
          <label>
            <span>Code</span>
            <input
              type="text"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
          </label>
        )}
        {notice && <div className="form-info">{notice}</div>}
        {error && <div className="form-error">{error}</div>}
        <button type="submit" disabled={busy || !email || (codeRequested && code.length !== 6)}>
          {busy ? 'Please wait…' : codeRequested ? 'Verify code' : 'Send code'}
        </button>
        {codeRequested && (
          <button
            type="button"
            className="link-button login-secondary-action"
            disabled={busy}
            onClick={() => {
              setCodeRequested(false);
              setCode('');
              setError('');
            }}
          >
            Use a different email
          </button>
        )}
      </form>
    </div>
  );
}
