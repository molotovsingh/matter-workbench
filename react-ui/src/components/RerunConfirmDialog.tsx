import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { getErrorMessage } from '../lib/errors';
import { cleanCommandLabel } from '../lib/nativeCommands';
import { humanizeArtifactPath, technicalPathTitle } from '../lib/presentationLabels';
import { RERUN_ADVICE_STATES } from '../lib/rerunAdviceState';
import { useLatestValue } from '../hooks/useLatestValue';
import type { RerunAdvice, RerunAdviceAction } from '../types';

interface Props {
  skill: string;
  title: string;
  matterName?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  extraActions?: RerunAdviceAction[] | ((advice: RerunAdvice) => RerunAdviceAction[]);
  onConfirm: () => void;
  onCancel: () => void;
  onAction?: (actionId: string) => void;
}

export default function RerunConfirmDialog({
  skill,
  title,
  matterName,
  confirmLabel = 'Regenerate anyway',
  cancelLabel = 'Keep current',
  extraActions = [],
  onConfirm,
  onCancel,
  onAction,
}: Props) {
  const [advice, setAdvice] = useState<RerunAdvice | null>(null);
  const [loading, setLoading] = useState(true);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onConfirmRef = useLatestValue(onConfirm);

  useEffect(() => {
    let cancelled = false;
    api.getRerunAdvice(skill, matterName).then((a) => {
      if (cancelled) return;
      if (!a.shouldConfirm) {
        onConfirmRef.current();
        return;
      }
      setAdvice(a);
      setLoading(false);
    }).catch((error) => {
      if (!cancelled) {
        setAdvice(rerunAdviceUnavailable(skill, error));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [skill, matterName, onConfirmRef]);

  useEffect(() => {
    if (advice && cancelRef.current) cancelRef.current.focus();
  }, [advice]);

  if (loading) return null;
  if (!advice) return null;

  const lastRun = advice.lastRunAt
    ? new Date(advice.lastRunAt).toLocaleString()
    : '—';
  const providerModel = [advice.provider, advice.model].filter(Boolean).join(' / ') || '—';
  const heading = advice.state === RERUN_ADVICE_STATES.UNKNOWN ? 'Could not verify current output' : title;
  const workLabel = cleanCommandLabel(skill);
  const artifactLabel = advice.artifactPath ? humanizeArtifactPath(advice.artifactPath) : '';
  const actions = typeof extraActions === 'function' ? extraActions(advice) : extraActions;
  const normalizedActions = Array.isArray(actions) ? actions : [];

  return (
    <div className="form-warning" role="alertdialog" aria-labelledby="rerunConfirmTitle">
      <h2 id="rerunConfirmTitle">{heading}</h2>
      {advice.message && <p style={{ whiteSpace: 'pre-line' }}>{advice.message}</p>}
      <ul className="overlap-list">
        <li><strong>Work:</strong> {workLabel}</li>
        {artifactLabel && <li title={technicalPathTitle(advice.artifactPath)}><strong>Current output:</strong> {artifactLabel}</li>}
        <li><strong>Last run:</strong> {lastRun}</li>
      </ul>
      <details style={{ margin: '8px 0' }}>
        <summary style={{ cursor: 'pointer' }}>Technical receipt</summary>
        <ul className="overlap-list" style={{ marginTop: 8 }}>
          <li><strong>Command:</strong> <code>{skill}</code></li>
          <li><strong>Provider / model:</strong> {providerModel}</li>
          <li><strong>State:</strong> {advice.state}</li>
          {advice.artifactPath && <li><strong>Path:</strong> <code>{advice.artifactPath}</code></li>}
        </ul>
      </details>
      <p>Regenerating can start a paid AI action and may replace the output document.</p>
      <div className="warning-actions">
        <button type="button" ref={cancelRef} onClick={onCancel}>{cancelLabel}</button>
        {normalizedActions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="secondary"
            onClick={() => onAction?.(action.id)}
          >
            {action.label}
          </button>
        ))}
        <button type="button" className="secondary" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  );
}

export async function checkRerunAdvice(skill: string, matterName?: string): Promise<RerunAdvice | null> {
  try {
    const advice = await api.getRerunAdvice(skill, matterName);
    return advice.shouldConfirm ? advice : null;
  } catch (error) {
    return rerunAdviceUnavailable(skill, error);
  }
}

function rerunAdviceUnavailable(skill: string, error: unknown): RerunAdvice {
  const message = getErrorMessage(error);
  return {
    skill,
    state: RERUN_ADVICE_STATES.UNKNOWN,
    shouldConfirm: true,
    artifactPath: '',
    message: [
      `Could not confirm whether ${cleanCommandLabel(skill)} has a current work product.`,
      `The rerun check failed: ${message}`,
      'Keep current unless you deliberately want to regenerate.',
    ].join('\n'),
  };
}
