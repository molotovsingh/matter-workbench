export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '—';
  const diffMs = Date.now() - time;
  const abs = Math.abs(diffMs);
  const future = diffMs < 0;
  if (abs < 60_000) return future ? 'in a moment' : 'just now';
  if (abs < 3_600_000) {
    const minutes = Math.round(abs / 60_000);
    return future ? `in ${minutes}m` : `${minutes}m ago`;
  }
  if (abs < 86_400_000) {
    const hours = Math.round(abs / 3_600_000);
    return future ? `in ${hours}h` : `${hours}h ago`;
  }
  const days = Math.round(abs / 86_400_000);
  return future ? `in ${days}d` : `${days}d ago`;
}

export function severityClass(severity: string): string {
  const normalized = String(severity || '').toLowerCase();
  if (normalized === 'blocker' || normalized === 'error') return 'bad';
  if (normalized === 'warning') return 'warn';
  if (normalized === 'info') return 'neutral';
  return 'neutral';
}

export function statusClass(status: string): string {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active') return 'ok';
  if (normalized === 'revoked') return 'bad';
  if (normalized === 'warning') return 'warn';
  if (normalized === 'error') return 'bad';
  return 'neutral';
}

export function patienceRiskClass(risk: string): string {
  const normalized = String(risk || '').toLowerCase();
  if (normalized === 'high') return 'bad';
  if (normalized === 'medium') return 'warn';
  return 'ok';
}
