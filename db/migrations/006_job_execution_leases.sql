-- Durable job leasing and outbox retry metadata for hosted workers.
-- This does not run workers yet. It gives the database enough state for a
-- worker to claim work, heartbeat, retry safely, and recover expired claims.

ALTER TABLE processing_jobs
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS run_after timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS lock_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS progress_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processing_jobs_attempt_count_nonnegative') THEN
    ALTER TABLE processing_jobs
      ADD CONSTRAINT processing_jobs_attempt_count_nonnegative
      CHECK (attempt_count >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processing_jobs_max_attempts_positive') THEN
    ALTER TABLE processing_jobs
      ADD CONSTRAINT processing_jobs_max_attempts_positive
      CHECK (max_attempts > 0);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS processing_jobs_claimable_idx
  ON processing_jobs (tenant_id, status, run_after, priority DESC, created_at)
  WHERE status IN ('queued', 'retrying');

CREATE INDEX IF NOT EXISTS processing_jobs_expired_lock_idx
  ON processing_jobs (tenant_id, lock_expires_at)
  WHERE status = 'running' AND lock_expires_at IS NOT NULL;

DROP TRIGGER IF EXISTS processing_jobs_set_updated_at ON processing_jobs;
CREATE TRIGGER processing_jobs_set_updated_at
  BEFORE UPDATE ON processing_jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

ALTER TABLE job_outbox
  ADD COLUMN IF NOT EXISTS event_key text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS last_error_message text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE job_outbox
  DROP CONSTRAINT IF EXISTS job_outbox_tenant_id_job_id_event_type_key;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_outbox_tenant_job_event_key_unique') THEN
    ALTER TABLE job_outbox
      ADD CONSTRAINT job_outbox_tenant_job_event_key_unique
      UNIQUE (tenant_id, job_id, event_type, event_key);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_outbox_attempt_count_nonnegative') THEN
    ALTER TABLE job_outbox
      ADD CONSTRAINT job_outbox_attempt_count_nonnegative
      CHECK (attempt_count >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_outbox_max_attempts_positive') THEN
    ALTER TABLE job_outbox
      ADD CONSTRAINT job_outbox_max_attempts_positive
      CHECK (max_attempts > 0);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS job_outbox_claimable_idx
  ON job_outbox (tenant_id, status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS job_outbox_expired_claim_idx
  ON job_outbox (tenant_id, claim_expires_at)
  WHERE status = 'claimed' AND claim_expires_at IS NOT NULL;

DROP TRIGGER IF EXISTS job_outbox_set_updated_at ON job_outbox;
CREATE TRIGGER job_outbox_set_updated_at
  BEFORE UPDATE ON job_outbox
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
