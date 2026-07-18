import type { JobStatus } from '../types';

export type PreparationJobPollResult =
  | { state: 'succeeded'; job: JobStatus }
  | { state: 'terminal'; job: JobStatus }
  | { state: 'stale'; job: null }
  | { state: 'timeout'; job: null };

export interface PollPreparationJobOptions {
  jobId?: string;
  kind?: string;
  maxPolls: number;
  maxConsecutiveErrors: number;
  getJobs: () => Promise<JobStatus[]>;
  wait: () => Promise<void>;
  isTransientError: (error: unknown) => boolean;
  isStale?: () => boolean;
  onTransientError?: (error: unknown, consecutiveErrors: number) => void;
  onRecovery?: () => void;
  onPending?: (job: JobStatus | null) => void;
}

export async function pollPreparationJob({
  jobId,
  kind,
  maxPolls,
  maxConsecutiveErrors,
  getJobs,
  wait,
  isTransientError,
  isStale = () => false,
  onTransientError = () => {},
  onRecovery = () => {},
  onPending = () => {},
}: PollPreparationJobOptions): Promise<PreparationJobPollResult> {
  let consecutiveErrors = 0;
  for (let poll = 0; poll < maxPolls; poll += 1) {
    if (isStale()) return { state: 'stale', job: null };
    let jobs: JobStatus[];
    try {
      jobs = await getJobs();
    } catch (error) {
      consecutiveErrors += 1;
      if (!isTransientError(error) || consecutiveErrors >= maxConsecutiveErrors) throw error;
      onTransientError(error, consecutiveErrors);
      await wait();
      continue;
    }
    if (consecutiveErrors > 0) onRecovery();
    consecutiveErrors = 0;
    const job = findServerPreparationJob(jobs, { jobId, kind });
    if (job?.status === 'succeeded') return { state: 'succeeded', job };
    if (job && ['failed', 'cancelled'].includes(job.status)) return { state: 'terminal', job };
    onPending(job);
    await wait();
  }
  return { state: 'timeout', job: null };
}

export function findServerPreparationJob(
  jobs: JobStatus[],
  { jobId, kind }: { jobId?: string; kind?: string },
): JobStatus | null {
  if (jobId) {
    return jobs.find((job) => job.id === jobId || job.backendJobId === jobId) || null;
  }
  if (kind) return jobs.find((job) => job.kind === kind) || null;
  return jobs[0] || null;
}
