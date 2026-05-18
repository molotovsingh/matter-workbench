import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import type { RerunAdvice } from '../types';

interface Props {
  skill: string;
  title: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function RerunConfirmDialog({
  skill,
  title,
  confirmLabel = 'Regenerate anyway',
  cancelLabel = 'Keep current',
  onConfirm,
  onCancel,
}: Props) {
  const [advice, setAdvice] = useState<RerunAdvice | null>(null);
  const [loading, setLoading] = useState(true);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.getRerunAdvice(skill).then((a) => {
      if (cancelled) return;
      if (!a.shouldConfirm) {
        onConfirm();
        return;
      }
      setAdvice(a);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) onConfirm();
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill]);

  useEffect(() => {
    if (advice && cancelRef.current) cancelRef.current.focus();
  }, [advice]);

  if (loading) return null;
  if (!advice) return null;

  const lastRun = advice.lastRunAt
    ? new Date(advice.lastRunAt).toLocaleString()
    : '—';
  const providerModel = [advice.provider, advice.model].filter(Boolean).join(' / ') || '—';

  return (
    <div className="form-warning" role="alertdialog" aria-labelledby="rerunConfirmTitle">
      <h2 id="rerunConfirmTitle">{title}</h2>
      {advice.message && <p>{advice.message}</p>}
      <ul className="overlap-list">
        <li><strong>Skill:</strong> <code>{skill}</code></li>
        {advice.artifactPath && <li><strong>Artifact:</strong> {advice.artifactPath}</li>}
        <li><strong>Last run:</strong> {lastRun}</li>
        <li><strong>Provider / model:</strong> {providerModel}</li>
        <li><strong>State:</strong> {advice.state}</li>
      </ul>
      <p>Regenerating can start a paid AI provider call and may replace the output document.</p>
      <div className="warning-actions">
        <button type="button" ref={cancelRef} onClick={onCancel}>{cancelLabel}</button>
        <button type="button" className="secondary" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  );
}

export async function checkRerunAdvice(skill: string): Promise<RerunAdvice | null> {
  try {
    const advice = await api.getRerunAdvice(skill);
    return advice.shouldConfirm ? advice : null;
  } catch {
    return null;
  }
}
