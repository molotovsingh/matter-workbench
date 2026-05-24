-- Canonical incident helpers for hosted worker/advisory projection.
-- These functions keep job, provider-run, and artifact-validation failures from
-- inventing ad hoc incident insert shapes in application code.

CREATE UNIQUE INDEX IF NOT EXISTS incidents_open_source_code_unique
  ON incidents (tenant_id, source_type, source_id, code)
  WHERE status = 'open';

CREATE OR REPLACE FUNCTION upsert_incident(
  p_matter_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_category text,
  p_code text,
  p_title text,
  p_detail text DEFAULT null,
  p_evidence_ref text DEFAULT null,
  p_severity text DEFAULT 'warning'
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  incident_id uuid;
BEGIN
  INSERT INTO incidents (
    tenant_id,
    matter_id,
    source_type,
    source_id,
    category,
    severity,
    status,
    code,
    title,
    detail,
    evidence_ref
  )
  VALUES (
    current_app_tenant_id(),
    p_matter_id,
    p_source_type,
    p_source_id,
    p_category,
    p_severity,
    'open',
    p_code,
    p_title,
    p_detail,
    p_evidence_ref
  )
  ON CONFLICT (tenant_id, source_type, source_id, code) WHERE status = 'open'
  DO UPDATE SET
    matter_id = excluded.matter_id,
    category = excluded.category,
    severity = excluded.severity,
    title = excluded.title,
    detail = excluded.detail,
    evidence_ref = excluded.evidence_ref,
    resolved_at = null
  RETURNING id INTO incident_id;

  RETURN incident_id;
END;
$$;

CREATE OR REPLACE FUNCTION record_job_failure_incident(
  p_job_id uuid,
  p_code text,
  p_title text,
  p_detail text DEFAULT null,
  p_evidence_ref text DEFAULT null,
  p_severity text DEFAULT 'warning',
  p_category text DEFAULT null
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  job_row processing_jobs%ROWTYPE;
BEGIN
  SELECT *
  INTO job_row
  FROM processing_jobs j
  WHERE j.id = p_job_id
    AND j.tenant_id = current_app_tenant_id();

  IF NOT FOUND THEN
    RETURN null;
  END IF;

  RETURN upsert_incident(
    p_matter_id => job_row.matter_id,
    p_source_type => 'job',
    p_source_id => job_row.id,
    p_category => coalesce(p_category, CASE job_row.kind
      WHEN 'intake' THEN 'intake'
      WHEN 'extract' THEN 'extraction'
      WHEN 'ocr' THEN 'extraction'
      WHEN 'source_labels' THEN 'source_labels'
      WHEN 'label_refresh' THEN 'source_labels'
      WHEN 'list_of_dates' THEN 'chronology'
      WHEN 'custom_skill' THEN 'custom_skill'
      WHEN 'export' THEN 'artifact'
      WHEN 'validation' THEN 'artifact'
      ELSE 'system'
    END),
    p_code => p_code,
    p_title => p_title,
    p_detail => coalesce(p_detail, job_row.error_message),
    p_evidence_ref => p_evidence_ref,
    p_severity => p_severity
  );
END;
$$;

CREATE OR REPLACE FUNCTION record_provider_run_failure_incident(
  p_provider_run_id uuid,
  p_code text,
  p_title text,
  p_detail text DEFAULT null,
  p_evidence_ref text DEFAULT null,
  p_severity text DEFAULT 'warning',
  p_category text DEFAULT null
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  provider_row provider_runs%ROWTYPE;
BEGIN
  SELECT *
  INTO provider_row
  FROM provider_runs pr
  WHERE pr.id = p_provider_run_id
    AND pr.tenant_id = current_app_tenant_id();

  IF NOT FOUND THEN
    RETURN null;
  END IF;

  RETURN upsert_incident(
    p_matter_id => provider_row.matter_id,
    p_source_type => 'provider_run',
    p_source_id => provider_row.id,
    p_category => coalesce(p_category, 'provider'),
    p_code => p_code,
    p_title => p_title,
    p_detail => coalesce(p_detail, provider_row.error_message),
    p_evidence_ref => p_evidence_ref,
    p_severity => p_severity
  );
END;
$$;

CREATE OR REPLACE FUNCTION record_artifact_validation_incident(
  p_validation_result_id uuid,
  p_code text DEFAULT null,
  p_title text DEFAULT null,
  p_detail text DEFAULT null,
  p_evidence_ref text DEFAULT null,
  p_severity text DEFAULT null,
  p_category text DEFAULT null
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  validation_row artifact_validation_results%ROWTYPE;
BEGIN
  SELECT *
  INTO validation_row
  FROM artifact_validation_results avr
  WHERE avr.id = p_validation_result_id
    AND avr.tenant_id = current_app_tenant_id();

  IF NOT FOUND THEN
    RETURN null;
  END IF;

  RETURN upsert_incident(
    p_matter_id => validation_row.matter_id,
    p_source_type => 'artifact_validation',
    p_source_id => validation_row.id,
    p_category => coalesce(p_category, 'artifact'),
    p_code => coalesce(p_code, validation_row.code),
    p_title => coalesce(p_title, validation_row.validation_kind || ' validation needs review'),
    p_detail => coalesce(p_detail, validation_row.detail),
    p_evidence_ref => coalesce(p_evidence_ref, validation_row.evidence_ref),
    p_severity => coalesce(p_severity, CASE validation_row.status
      WHEN 'failed' THEN 'blocker'
      WHEN 'warning' THEN 'warning'
      ELSE 'info'
    END)
  );
END;
$$;

CREATE OR REPLACE FUNCTION resolve_incident(
  p_incident_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE incidents
  SET status = 'resolved',
      resolved_at = now()
  WHERE id = p_incident_id
    AND tenant_id = current_app_tenant_id()
    AND status = 'open';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END;
$$;
