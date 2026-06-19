import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { UserReadinessCheck, UserReadinessReport } from '../types';

export interface ReadinessGateState {
  phase: 'idle' | 'checking' | 'ready' | 'degraded' | 'timeout' | 'error';
  dismissed: boolean;
  startedAt: number;
  elapsedSeconds: number;
  currentStep: number;
  checks: UserReadinessCheck[];
  report: UserReadinessReport | null;
  message: string;
}

export const USER_READINESS_STEPS: UserReadinessCheck[] = [
  { id: 'secure_session', label: 'Secure session', status: 'checking' },
  { id: 'workspace_access', label: 'Workspace access', status: 'checking' },
  { id: 'matter_library', label: 'Matter library', status: 'checking' },
  { id: 'document_services', label: 'Document services', status: 'checking' },
  { id: 'assistant_readiness', label: 'Assistant readiness', status: 'checking' },
];

const AUTO_OPEN_AFTER_MS = 8_000;
const SUCCESS_SETTLE_MS = 900;
const ERROR_SETTLE_MS = 1_200;
const PROGRESS_TICK_MS = 500;

export function initialReadinessGateState(): ReadinessGateState {
  return {
    phase: 'idle',
    dismissed: false,
    startedAt: 0,
    elapsedSeconds: 0,
    currentStep: 1,
    checks: USER_READINESS_STEPS,
    report: null,
    message: 'Checking service readiness…',
  };
}

export function useUserReadinessGate({
  authenticated,
  appendTerminal,
}: {
  authenticated: boolean;
  appendTerminal: (lines: string[]) => void;
}) {
  const [readinessGate, setReadinessGate] = useState<ReadinessGateState>(() => initialReadinessGateState());
  const readinessSeqRef = useRef(0);

  const resetReadinessGate = useCallback(() => {
    readinessSeqRef.current += 1;
    setReadinessGate(initialReadinessGateState());
  }, []);

  useEffect(() => {
    if (!authenticated) {
      setReadinessGate(initialReadinessGateState());
      return undefined;
    }

    const seq = readinessSeqRef.current + 1;
    readinessSeqRef.current = seq;
    const startedAt = Date.now();
    let cancelled = false;
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const total = USER_READINESS_STEPS.length;

    setReadinessGate({
      phase: 'checking',
      dismissed: false,
      startedAt,
      elapsedSeconds: 0,
      currentStep: 1,
      checks: USER_READINESS_STEPS,
      report: null,
      message: 'Checking service readiness…',
    });

    const progressTimer = setInterval(() => {
      if (cancelled || readinessSeqRef.current !== seq) return;
      setReadinessGate((current) => {
        if (current.dismissed || current.phase !== 'checking') return current;
        const elapsedSeconds = elapsedSecondsSince(startedAt);
        return { ...current, elapsedSeconds };
      });
    }, PROGRESS_TICK_MS);

    releaseTimer = setTimeout(() => {
      if (cancelled || readinessSeqRef.current !== seq) return;
      setReadinessGate((current) => ({
        ...current,
        phase: 'timeout',
        dismissed: true,
        elapsedSeconds: Math.max(current.elapsedSeconds, elapsedSecondsSince(startedAt)),
        message: 'Service readiness is taking longer than usual. Opening the workspace now.',
      }));
      appendTerminal(['[readiness] service readiness is taking longer than usual; workspace opened']);
    }, AUTO_OPEN_AFTER_MS);

    api.getUserReadiness()
      .then((report) => {
        if (cancelled || readinessSeqRef.current !== seq) return;
        const elapsedSeconds = elapsedSecondsSince(startedAt);
        const checks = report.checks?.length ? report.checks : USER_READINESS_STEPS;
        const phase = report.status === 'ready' ? 'ready' : 'degraded';
        const message = report.userMessage || (phase === 'ready'
          ? 'Workspace ready.'
          : 'Some services need attention. You can continue using the workspace.');
        setReadinessGate((current) => ({
          ...current,
          phase,
          dismissed: current.dismissed,
          elapsedSeconds,
          currentStep: checks.length,
          checks,
          report,
          message,
        }));
        appendTerminal([phase === 'ready' ? '[readiness] workspace ready' : '[readiness] workspace opened with service attention']);
        if (releaseTimer) clearTimeout(releaseTimer);
        settleTimer = setTimeout(() => {
          if (cancelled || readinessSeqRef.current !== seq) return;
          setReadinessGate((current) => ({ ...current, dismissed: true }));
        }, SUCCESS_SETTLE_MS);
      })
      .catch(() => {
        if (cancelled || readinessSeqRef.current !== seq) return;
        const elapsedSeconds = elapsedSecondsSince(startedAt);
        setReadinessGate((current) => ({
          ...current,
          phase: 'error',
          dismissed: current.dismissed,
          elapsedSeconds,
          currentStep: total,
          checks: USER_READINESS_STEPS.map((step) => (
            step.id === 'assistant_readiness'
              ? { ...step, status: 'attention', message: 'Assistant readiness could not be confirmed. You can continue using the workspace.' }
              : { ...step, status: 'ready', message: 'Ready.' }
          )),
          message: 'Service readiness could not be confirmed. You can continue using the workspace.',
        }));
        appendTerminal(['[readiness] service readiness could not be confirmed; workspace opened']);
        if (releaseTimer) clearTimeout(releaseTimer);
        settleTimer = setTimeout(() => {
          if (cancelled || readinessSeqRef.current !== seq) return;
          setReadinessGate((current) => ({ ...current, dismissed: true }));
        }, ERROR_SETTLE_MS);
      });

    return () => {
      cancelled = true;
      clearInterval(progressTimer);
      if (releaseTimer) clearTimeout(releaseTimer);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [appendTerminal, authenticated]);

  return { readinessGate, resetReadinessGate };
}

function elapsedSecondsSince(startedAt: number): number {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}
