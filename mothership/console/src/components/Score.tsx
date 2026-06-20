interface ScoreProps {
  label: string;
  value?: number | string | null;
  isText?: boolean;
  suffix?: string;
}

export function Score({ label, value, isText, suffix }: ScoreProps) {
  const display = value === null || value === undefined || value === '' ? '—' : isText ? String(value) : `${value}${suffix || ''}`;
  return (
    <div className="score">
      <div className="score-value">{display}</div>
      <div className="score-label">{label}</div>
    </div>
  );
}
