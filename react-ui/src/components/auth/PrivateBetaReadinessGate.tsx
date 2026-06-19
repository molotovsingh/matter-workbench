import type { UserReadinessCheck } from '../../types';
import {
  USER_READINESS_STEPS,
  type ReadinessGateState,
} from '../../hooks/useUserReadinessGate';

export default function PrivateBetaReadinessGate({ gate }: { gate: ReadinessGateState }) {
  const checks = gate.checks.length ? gate.checks : USER_READINESS_STEPS;
  const settled = ['ready', 'degraded', 'error'].includes(gate.phase);
  const elapsedSeconds = Math.max(0, gate.elapsedSeconds || (gate.startedAt ? Math.floor((Date.now() - gate.startedAt) / 1000) : 0));
  const title = gate.phase === 'ready' ? 'Workspace ready' : 'Preparing your workspace';
  const summary = gate.message || 'Checking service readiness…';
  const counterText = settled ? 'Readiness check complete' : 'Checking workspace readiness';

  return (
    <div className="private-beta-auth-screen">
      <div className="private-beta-auth-card readiness-card">
        <div className="section-kicker">Matter Workbench</div>
        <h1>{title}</h1>
        <p aria-live="polite">{summary}</p>
        <div className="readiness-counter" aria-live="off">
          {counterText} · {elapsedSeconds}s elapsed
        </div>
        <ol className="readiness-check-list">
          {checks.map((check) => {
            const status = readinessCheckStatus(check, gate.phase);
            return (
              <li key={check.id} className={`readiness-check ${status}`}>
                <span className="readiness-check-dot" aria-hidden="true" />
                <span>
                  <strong>{check.label}</strong>
                  {check.message && <small>{check.message}</small>}
                </span>
                <em>{readinessStatusLabel(status)}</em>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function readinessCheckStatus(
  check: UserReadinessCheck,
  phase: ReadinessGateState['phase'],
): string {
  if (check.status === 'attention') return 'attention';
  if (check.status === 'ready') return 'ready';
  if (check.status === 'checking') return 'checking';
  if (['ready', 'degraded', 'error'].includes(phase)) return check.status || 'ready';
  return 'pending';
}

function readinessStatusLabel(status: string): string {
  if (status === 'ready') return 'Ready';
  if (status === 'attention') return 'Needs attention';
  if (status === 'checking') return 'Checking';
  return 'Waiting';
}
