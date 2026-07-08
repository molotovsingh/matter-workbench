import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { getErrorMessage } from '../lib/errors';
import type { JobStatus, PreparationRunStatus } from '../types';

type RefreshActiveMatterWorkspace = (opts?: { expectedMatterName?: string; failurePrefix?: string }) => Promise<unknown>;

type BackendPreparationJobState = {
  preparationRun: PreparationRunStatus | null;
  hasFailedJob: boolean;
  error: string | null;
  refreshKey: string;
};

type PreparationJobKind = typeof PREPARATION_JOB_KINDS[number];

type PreparationJobStep = {
  kind: PreparationJobKind;
  id: string;
  label: string;
};

export const PREPARATION_JOB_KINDS = ['matter_init', 'extract', 'source_labels', 'case_timeline', 'matter_story', 'posture_diagnosis'] as const;
export const ACTIVE_PREPARATION_JOB_STATUSES = new Set(['queued', 'running', 'retrying']);

const PREPARATION_JOB_POLL_MS = 5_000;
const PREPARATION_JOB_IDLE_POLL_MS = 15_000;

const PREPARATION_JOB_STEPS: PreparationJobStep[] = [
  { kind: 'matter_init', id: 'matter-init', label: 'Registering files' },
  { kind: 'extract', id: 'extract', label: 'Reading documents' },
  { kind: 'source_labels', id: 'describe-sources', label: 'Preparing source record' },
  { kind: 'case_timeline', id: 'case-timeline', label: 'Building Case Timeline' },
  { kind: 'matter_story', id: 'dispute-story', label: 'Writing dispute story' },
  { kind: 'posture_diagnosis', id: 'procedural-posture-diagnosis', label: 'Diagnosing procedural posture' },
];

export function useBackendPreparationJobs({
  matterName,
  localPreparationRun,
  refreshActiveMatterWorkspace,
  appendTerminal,
}: {
  matterName: string;
  localPreparationRun: PreparationRunStatus | null;
  refreshActiveMatterWorkspace: RefreshActiveMatterWorkspace;
  appendTerminal: (lines: string[]) => void;
}): BackendPreparationJobState {
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshSeq, setRefreshSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sawActiveBackendJob = false;

    const poll = async () => {
      try {
        const payload = await api.getJobs({ matterName, limit: 50 });
        if (cancelled) return;
        const preparationJobs = filterPreparationJobs(payload.jobs || []);
        const activeJobs = preparationJobs.filter(isActivePreparationJob);
        setJobs(preparationJobs);
        setError(null);

        if (activeJobs.length > 0) {
          sawActiveBackendJob = true;
        } else if (sawActiveBackendJob) {
          sawActiveBackendJob = false;
          appendTerminal(['[prepare] server preparation finished; refreshing matter workspace']);
          await refreshActiveMatterWorkspace({
            expectedMatterName: matterName,
            failurePrefix: '[workspace] refresh failed after server preparation',
          });
          if (!cancelled) setRefreshSeq((seq) => seq + 1);
        }
        if (!cancelled) timer = setTimeout(poll, activeJobs.length > 0 ? PREPARATION_JOB_POLL_MS : PREPARATION_JOB_IDLE_POLL_MS);
      } catch (e) {
        if (cancelled) return;
        setError(getErrorMessage(e));
        timer = setTimeout(poll, PREPARATION_JOB_IDLE_POLL_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [matterName, appendTerminal, refreshActiveMatterWorkspace]);

  const activeJobs = jobs.filter(isActivePreparationJob);
  const localRunIsRunning = localPreparationRun?.state === 'running';
  return {
    preparationRun: activeJobs.length > 0 && !localRunIsRunning ? preparationRunFromBackendJobs(matterName, jobs) : null,
    hasFailedJob: activeJobs.length === 0 && hasLatestPreparationFailure(jobs),
    error,
    refreshKey: `jobs:${refreshSeq}:${jobSignature(jobs)}`,
  };
}

export function filterPreparationJobs(jobs: JobStatus[]): JobStatus[] {
  return jobs
    .filter((job) => PREPARATION_JOB_KINDS.includes(job.kind as PreparationJobKind))
    .sort((a, b) => jobTime(b) - jobTime(a));
}

export function isActivePreparationJob(job: JobStatus): boolean {
  return ACTIVE_PREPARATION_JOB_STATUSES.has(job.status);
}

export function preparationRunFromBackendJobs(matterName: string, jobs: JobStatus[]): PreparationRunStatus {
  const activeJob = jobs.find(isActivePreparationJob);
  return {
    matterName,
    state: 'running',
    message: 'Preparation running on server… You can refresh; progress is kept in Activity.',
    startedAt: activeJob?.startedAt || activeJob?.updatedAt || new Date().toISOString(),
    steps: PREPARATION_JOB_STEPS.map((step) => backendProgressStep(step, jobs)),
  };
}

function backendProgressStep(step: PreparationJobStep, jobs: JobStatus[]): PreparationRunStatus['steps'][number] {
  const job = jobs.find((candidate) => candidate.kind === step.kind);
  if (!job) return { id: step.id, label: step.label, state: 'pending' };
  if (isActivePreparationJob(job)) return { id: step.id, label: step.label, state: 'running', detail: backendJobDetail(job) };
  if (job.status === 'succeeded') return { id: step.id, label: step.label, state: 'done' };
  if (job.status === 'failed' || job.status === 'cancelled') return { id: step.id, label: step.label, state: 'failed', detail: 'Server preparation stopped before this step completed.' };
  return { id: step.id, label: step.label, state: 'pending' };
}

function backendJobDetail(job: JobStatus): string {
  if (job.status === 'queued') return 'Queued on the server.';
  if (job.status === 'retrying') return 'Retrying on the server.';
  return 'Running on the server.';
}

function hasLatestPreparationFailure(jobs: JobStatus[]): boolean {
  const latest = jobs[0];
  return Boolean(latest && (latest.status === 'failed' || latest.status === 'cancelled'));
}

function jobSignature(jobs: JobStatus[]): string {
  return jobs.slice(0, 6).map((job) => `${job.id}:${job.status}:${job.updatedAt || job.finishedAt || job.startedAt}`).join('|');
}

function jobTime(job: JobStatus): number {
  const value = job.updatedAt || job.finishedAt || job.startedAt || '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}
