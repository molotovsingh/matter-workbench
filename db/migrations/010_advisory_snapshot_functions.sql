-- Preparation Advisory snapshot helpers.
-- Snapshots are append-only projections over canonical incidents and validation
-- rows. They preserve what a user saw after preparation without making
-- "attention" a second source of truth.

CREATE INDEX IF NOT EXISTS preparation_advisory_snapshots_matter_created_idx
  ON preparation_advisory_snapshots (tenant_id, matter_id, created_at DESC);

CREATE OR REPLACE FUNCTION create_preparation_advisory_snapshot(
  p_matter_id uuid,
  p_preparation_run_id uuid DEFAULT null,
  p_generated_by_job_id uuid DEFAULT null,
  p_rendered_summary_json jsonb DEFAULT '{}'::jsonb,
  p_app_version text DEFAULT null,
  p_policy_versions_json jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_id uuid;
  open_incident_ids uuid[] := ARRAY[]::uuid[];
  validation_result_ids uuid[] := ARRAY[]::uuid[];
  blocker_total integer := 0;
  warning_total integer := 0;
  info_total integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM matters m
    WHERE m.id = p_matter_id
      AND m.tenant_id = current_app_tenant_id()
  ) THEN
    RAISE EXCEPTION 'matter not found for current tenant';
  END IF;

  SELECT
    count(*) FILTER (WHERE severity = 'blocker'),
    count(*) FILTER (WHERE severity = 'warning'),
    count(*) FILTER (WHERE severity = 'info'),
    coalesce(
      array_agg(id ORDER BY CASE severity
        WHEN 'blocker' THEN 1
        WHEN 'warning' THEN 2
        ELSE 3
      END, created_at DESC),
      ARRAY[]::uuid[]
    )
  INTO blocker_total, warning_total, info_total, open_incident_ids
  FROM incidents i
  WHERE i.tenant_id = current_app_tenant_id()
    AND i.matter_id = p_matter_id
    AND i.status = 'open';

  SELECT coalesce(array_agg(avr.id ORDER BY avr.created_at DESC), ARRAY[]::uuid[])
  INTO validation_result_ids
  FROM artifact_validation_results avr
  WHERE avr.tenant_id = current_app_tenant_id()
    AND avr.matter_id = p_matter_id
    AND avr.status IN ('warning', 'failed');

  INSERT INTO preparation_advisory_snapshots (
    tenant_id,
    matter_id,
    preparation_run_id,
    generated_by_job_id,
    blocker_count,
    warning_count,
    info_count,
    incident_ids,
    artifact_validation_result_ids,
    rendered_summary_json,
    app_version,
    policy_versions_json
  )
  VALUES (
    current_app_tenant_id(),
    p_matter_id,
    p_preparation_run_id,
    p_generated_by_job_id,
    blocker_total,
    warning_total,
    info_total,
    open_incident_ids,
    validation_result_ids,
    coalesce(p_rendered_summary_json, '{}'::jsonb),
    p_app_version,
    coalesce(p_policy_versions_json, '{}'::jsonb)
  )
  RETURNING id INTO snapshot_id;

  RETURN snapshot_id;
END;
$$;
