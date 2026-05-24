-- Atomic worker functions for hosted processing jobs and outbox events.
-- These functions are security-invoker by default and rely on the caller's
-- tenant context through current_app_tenant_id().

CREATE OR REPLACE FUNCTION claim_next_processing_job(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (
  job_id uuid,
  tenant_id uuid,
  matter_id uuid,
  job_kind text,
  attempt_count integer,
  max_attempts integer,
  idempotency_key text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT j.id
    FROM processing_jobs j
    WHERE j.tenant_id = current_app_tenant_id()
      AND j.status IN ('queued', 'retrying')
      AND j.run_after <= now()
      AND j.attempt_count < j.max_attempts
    ORDER BY j.priority DESC, j.run_after ASC, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE processing_jobs j
  SET status = 'running',
      locked_by = p_worker_id,
      locked_at = now(),
      lock_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
      last_heartbeat_at = now(),
      started_at = coalesce(j.started_at, now()),
      attempt_count = j.attempt_count + 1,
      error_code = null,
      error_message = null,
      updated_at = now()
  FROM candidate
  WHERE j.id = candidate.id
  RETURNING
    j.id,
    j.tenant_id,
    j.matter_id,
    j.kind,
    j.attempt_count,
    j.max_attempts,
    j.idempotency_key;
END;
$$;

CREATE OR REPLACE FUNCTION heartbeat_processing_job(
  p_job_id uuid,
  p_worker_id text,
  p_progress_json jsonb DEFAULT '{}'::jsonb,
  p_lease_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE processing_jobs
  SET last_heartbeat_at = now(),
      lock_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
      progress_json = coalesce(progress_json, '{}'::jsonb) || coalesce(p_progress_json, '{}'::jsonb),
      updated_at = now()
  WHERE id = p_job_id
    AND tenant_id = current_app_tenant_id()
    AND status = 'running'
    AND locked_by = p_worker_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION complete_processing_job(
  p_job_id uuid,
  p_worker_id text,
  p_succeeded boolean,
  p_error_code text DEFAULT null,
  p_error_message text DEFAULT null,
  p_retry_after_seconds integer DEFAULT null
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE processing_jobs
  SET status = CASE
        WHEN p_succeeded THEN 'succeeded'
        WHEN attempt_count < max_attempts THEN 'retrying'
        ELSE 'failed'
      END,
      run_after = CASE
        WHEN p_succeeded THEN run_after
        WHEN attempt_count < max_attempts THEN now() + make_interval(secs => greatest(coalesce(p_retry_after_seconds, 60), 1))
        ELSE run_after
      END,
      finished_at = CASE
        WHEN p_succeeded THEN now()
        WHEN attempt_count >= max_attempts THEN now()
        ELSE null
      END,
      error_code = CASE WHEN p_succeeded THEN null ELSE p_error_code END,
      error_message = CASE WHEN p_succeeded THEN null ELSE p_error_message END,
      locked_by = null,
      locked_at = null,
      lock_expires_at = null,
      last_heartbeat_at = null,
      updated_at = now()
  WHERE id = p_job_id
    AND tenant_id = current_app_tenant_id()
    AND status = 'running'
    AND locked_by = p_worker_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION claim_next_job_outbox_event(
  p_worker_id text,
  p_claim_seconds integer DEFAULT 300
)
RETURNS TABLE (
  outbox_id uuid,
  tenant_id uuid,
  job_id uuid,
  event_type text,
  event_key text,
  payload_json jsonb,
  attempt_count integer,
  max_attempts integer
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT o.id
    FROM job_outbox o
    WHERE o.tenant_id = current_app_tenant_id()
      AND o.status = 'pending'
      AND o.attempt_count < o.max_attempts
    ORDER BY o.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE job_outbox o
  SET status = 'claimed',
      claimed_by = p_worker_id,
      claimed_at = now(),
      claim_expires_at = now() + make_interval(secs => greatest(p_claim_seconds, 30)),
      attempt_count = o.attempt_count + 1,
      last_error_code = null,
      last_error_message = null,
      updated_at = now()
  FROM candidate
  WHERE o.id = candidate.id
  RETURNING
    o.id,
    o.tenant_id,
    o.job_id,
    o.event_type,
    o.event_key,
    o.payload_json,
    o.attempt_count,
    o.max_attempts;
END;
$$;

CREATE OR REPLACE FUNCTION complete_job_outbox_event(
  p_outbox_id uuid,
  p_worker_id text,
  p_published boolean,
  p_error_code text DEFAULT null,
  p_error_message text DEFAULT null
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE job_outbox
  SET status = CASE
        WHEN p_published THEN 'published'
        WHEN attempt_count < max_attempts THEN 'pending'
        ELSE 'failed'
      END,
      published_at = CASE WHEN p_published THEN now() ELSE published_at END,
      claimed_by = null,
      claimed_at = null,
      claim_expires_at = null,
      last_error_code = CASE WHEN p_published THEN null ELSE p_error_code END,
      last_error_message = CASE WHEN p_published THEN null ELSE p_error_message END,
      updated_at = now()
  WHERE id = p_outbox_id
    AND tenant_id = current_app_tenant_id()
    AND status = 'claimed'
    AND claimed_by = p_worker_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END;
$$;
