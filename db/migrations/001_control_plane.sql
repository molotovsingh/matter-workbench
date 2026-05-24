-- Matter Workbench hosted control-plane baseline.
-- This migration defines identity, job, provider, advisory, artifact, and
-- custom-skill ledgers. Large files and generated legal artifacts stay in
-- private object storage and are referenced by object_key columns.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('personal_beta', 'firm', 'internal_test')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted_pending')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS matters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  created_by_user_id uuid REFERENCES users(id),
  name text NOT NULL,
  client_name text,
  opposite_party text,
  matter_type text,
  jurisdiction text,
  brief_description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted_pending')),
  next_file_number integer NOT NULL DEFAULT 1 CHECK (next_file_number > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS matter_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL REFERENCES matters(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (matter_id, user_id)
);

CREATE TABLE IF NOT EXISTS matter_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL REFERENCES matters(id),
  label text NOT NULL,
  received_at timestamptz,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL REFERENCES matters(id),
  intake_id uuid REFERENCES matter_intakes(id),
  idempotency_key text NOT NULL,
  created_by_user_id uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'uploaded', 'verified', 'partial_failed', 'failed', 'cancelled')),
  expected_file_count integer NOT NULL DEFAULT 0 CHECK (expected_file_count >= 0),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL REFERENCES matters(id),
  intake_id uuid REFERENCES matter_intakes(id),
  upload_session_id uuid REFERENCES upload_sessions(id),
  file_number integer NOT NULL CHECK (file_number > 0),
  file_id text NOT NULL,
  original_name text NOT NULL,
  category text,
  sha256 text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  duplicate_of_document_id uuid REFERENCES documents(id),
  status text NOT NULL DEFAULT 'pending_upload' CHECK (status IN ('pending_upload', 'uploaded', 'verified', 'duplicate', 'unsupported', 'failed', 'deleted_pending')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (matter_id, file_number),
  UNIQUE (matter_id, file_id)
);

CREATE TABLE IF NOT EXISTS document_blobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL REFERENCES matters(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  blob_kind text NOT NULL CHECK (blob_kind IN ('original', 'normalized_working_copy')),
  object_key text NOT NULL,
  mime_type text,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'uploaded', 'verified', 'failed', 'orphaned', 'deleted_pending')),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  UNIQUE (tenant_id, object_key)
);

CREATE TABLE IF NOT EXISTS extraction_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL REFERENCES matters(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  document_blob_id uuid REFERENCES document_blobs(id),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'needs_ocr', 'unsupported')),
  engine text NOT NULL,
  engine_version text,
  page_count integer CHECK (page_count IS NULL OR page_count >= 0),
  ocr_applied boolean NOT NULL DEFAULT false,
  needs_review boolean NOT NULL DEFAULT false,
  payload_object_key text,
  content_hash text,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_text_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL REFERENCES matters(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  extraction_record_id uuid NOT NULL REFERENCES extraction_records(id),
  page integer NOT NULL CHECK (page > 0),
  block integer NOT NULL CHECK (block > 0),
  citation text NOT NULL,
  text text,
  text_object_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (extraction_record_id, page, block)
);

CREATE TABLE IF NOT EXISTS source_descriptors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL REFERENCES matters(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  extraction_record_id uuid REFERENCES extraction_records(id),
  suggested_label text,
  confirmed_label text,
  label_status text NOT NULL DEFAULT 'suggested' CHECK (label_status IN ('suggested', 'confirmed', 'overridden', 'needs_review')),
  label_source text NOT NULL DEFAULT 'model' CHECK (label_source IN ('model', 'filename', 'document_text', 'lawyer_override')),
  confirmed_by_user_id uuid REFERENCES users(id),
  confirmed_at timestamptz,
  document_type text,
  document_date date,
  needs_review boolean NOT NULL DEFAULT false,
  provider_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid REFERENCES matters(id),
  kind text NOT NULL CHECK (kind IN ('intake', 'extract', 'ocr', 'source_labels', 'list_of_dates', 'label_refresh', 'custom_skill', 'export', 'validation')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'retrying')),
  idempotency_key text NOT NULL,
  created_by_user_id uuid REFERENCES users(id),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS job_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  job_id uuid NOT NULL REFERENCES processing_jobs(id),
  event_type text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'published', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (tenant_id, job_id, event_type)
);

CREATE TABLE IF NOT EXISTS provider_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid REFERENCES matters(id),
  job_id uuid REFERENCES processing_jobs(id),
  task_class text NOT NULL CHECK (task_class IN ('copilot', 'skill_creation', 'skill_modification', 'skill_execution', 'native_source_skill', 'validation')),
  provider text NOT NULL,
  model text NOT NULL,
  policy_prompt_version text,
  prompt_version text,
  input_artifact_id uuid,
  output_artifact_id uuid,
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'succeeded', 'failed', 'cancelled')),
  error_code text,
  error_message text,
  usage_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cost_amount numeric,
  cost_currency text,
  cost_confidence text NOT NULL DEFAULT 'unknown' CHECK (cost_confidence IN ('actual', 'estimated', 'planned', 'unknown')),
  approval_event_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS matter_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL REFERENCES matters(id),
  artifact_family text NOT NULL CHECK (artifact_family IN ('source_index', 'list_of_dates', 'context_packet', 'draft', 'dispatch_copy', 'export', 'custom_skill_output')),
  mode text NOT NULL DEFAULT 'default',
  profile_key text NOT NULL DEFAULT 'default',
  format text NOT NULL CHECK (format IN ('json', 'md', 'csv', 'pdf', 'docx', 'txt')),
  schema_version text,
  object_key text,
  content_hash text,
  created_by_job_id uuid REFERENCES processing_jobs(id),
  source_artifact_id uuid REFERENCES matter_artifacts(id),
  source_index_hash text,
  extraction_snapshot_hash text,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS matter_artifacts_one_current_per_scope
  ON matter_artifacts (matter_id, artifact_family, mode, profile_key, format)
  WHERE is_current = true;

CREATE TABLE IF NOT EXISTS artifact_validation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL REFERENCES matters(id),
  artifact_id uuid REFERENCES matter_artifacts(id),
  validation_kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('passed', 'warning', 'failed')),
  code text NOT NULL,
  detail text,
  evidence_ref text,
  created_by_job_id uuid REFERENCES processing_jobs(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid REFERENCES matters(id),
  source_type text NOT NULL CHECK (source_type IN ('job', 'provider_run', 'artifact_validation', 'system', 'manual')),
  source_id uuid,
  category text NOT NULL CHECK (category IN ('intake', 'extraction', 'source_labels', 'chronology', 'provider', 'custom_skill', 'artifact', 'security', 'system')),
  severity text NOT NULL CHECK (severity IN ('blocker', 'warning', 'info')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  code text NOT NULL,
  title text NOT NULL,
  detail text,
  evidence_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS attention_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL REFERENCES matters(id),
  incident_id uuid NOT NULL REFERENCES incidents(id),
  user_id uuid REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('acknowledged', 'ignored')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (incident_id, user_id)
);

CREATE TABLE IF NOT EXISTS preparation_advisory_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL REFERENCES matters(id),
  preparation_run_id uuid REFERENCES processing_jobs(id),
  generated_by_job_id uuid REFERENCES processing_jobs(id),
  blocker_count integer NOT NULL DEFAULT 0 CHECK (blocker_count >= 0),
  warning_count integer NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  info_count integer NOT NULL DEFAULT 0 CHECK (info_count >= 0),
  incident_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  artifact_validation_result_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  rendered_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  app_version text,
  policy_versions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cost_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid REFERENCES matters(id),
  provider_run_id uuid REFERENCES provider_runs(id),
  job_id uuid REFERENCES processing_jobs(id),
  approval_event_id uuid,
  scope text NOT NULL CHECK (scope IN ('session', 'matter', 'tenant')),
  amount numeric,
  currency text,
  confidence text NOT NULL DEFAULT 'unknown' CHECK (confidence IN ('actual', 'estimated', 'planned', 'unknown')),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  provider text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'worker', 'system')),
  actor_user_id uuid REFERENCES users(id),
  matter_id uuid REFERENCES matters(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  ip_address inet,
  user_agent text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skill_ideas (
  id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid REFERENCES matters(id),
  created_by_user_id uuid REFERENCES users(id),
  text text NOT NULL,
  status text NOT NULL CHECK (status IN ('incomplete', 'ready_for_review', 'parked', 'dismissed')),
  matter_name text,
  matter_folder_name text,
  design_brief_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skill_samples (
  id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  idea_id text NOT NULL REFERENCES skill_ideas(id),
  matter_id uuid REFERENCES matters(id),
  version integer NOT NULL CHECK (version > 0),
  approved boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  design_brief_hash text NOT NULL,
  sample_markdown_object_key text,
  sample_hash text,
  feedback text,
  ai_run_id uuid REFERENCES provider_runs(id),
  warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_sample_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idea_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS skill_samples_one_approved_per_idea
  ON skill_samples (idea_id)
  WHERE approved = true;

CREATE TABLE IF NOT EXISTS configurable_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  created_by_user_id uuid REFERENCES users(id),
  title text NOT NULL,
  slash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'disabled', 'suspended', 'archived', 'deleted')),
  current_version_id uuid,
  previous_status text,
  status_changed_at timestamptz,
  status_changed_by uuid REFERENCES users(id),
  status_change_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS configurable_skills_active_slash
  ON configurable_skills (tenant_id, slash)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS configurable_skill_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  skill_id uuid NOT NULL REFERENCES configurable_skills(id),
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'disabled')),
  definition_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_idea_id text,
  sample_artifact_id uuid REFERENCES matter_artifacts(id),
  policy_prompt_version text,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, version_number)
);

CREATE TABLE IF NOT EXISTS configurable_skill_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid REFERENCES matters(id),
  skill_id uuid NOT NULL REFERENCES configurable_skills(id),
  skill_version_id uuid REFERENCES configurable_skill_versions(id),
  job_id uuid REFERENCES processing_jobs(id),
  provider_run_id uuid REFERENCES provider_runs(id),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
  receipt_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_artifact_id uuid REFERENCES matter_artifacts(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error_code text,
  error_message text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'source_descriptors_provider_run_fk'
  ) THEN
    ALTER TABLE source_descriptors
      ADD CONSTRAINT source_descriptors_provider_run_fk
      FOREIGN KEY (provider_run_id) REFERENCES provider_runs(id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_runs_input_artifact_fk'
  ) THEN
    ALTER TABLE provider_runs
      ADD CONSTRAINT provider_runs_input_artifact_fk
      FOREIGN KEY (input_artifact_id) REFERENCES matter_artifacts(id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_runs_output_artifact_fk'
  ) THEN
    ALTER TABLE provider_runs
      ADD CONSTRAINT provider_runs_output_artifact_fk
      FOREIGN KEY (output_artifact_id) REFERENCES matter_artifacts(id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'configurable_skills_current_version_fk'
  ) THEN
    ALTER TABLE configurable_skills
      ADD CONSTRAINT configurable_skills_current_version_fk
      FOREIGN KEY (current_version_id) REFERENCES configurable_skill_versions(id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION allocate_matter_file_number(target_matter_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  allocated_number integer;
BEGIN
  SELECT next_file_number
  INTO allocated_number
  FROM matters
  WHERE id = target_matter_id
  FOR UPDATE;

  IF allocated_number IS NULL THEN
    RAISE EXCEPTION 'matter not found for file allocation: %', target_matter_id;
  END IF;

  UPDATE matters
  SET next_file_number = allocated_number + 1,
      updated_at = now()
  WHERE id = target_matter_id;

  RETURN allocated_number;
END;
$$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_set_updated_at ON tenants;
CREATE TRIGGER tenants_set_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS tenant_memberships_set_updated_at ON tenant_memberships;
CREATE TRIGGER tenant_memberships_set_updated_at
  BEFORE UPDATE ON tenant_memberships
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS matters_set_updated_at ON matters;
CREATE TRIGGER matters_set_updated_at
  BEFORE UPDATE ON matters
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS matter_memberships_set_updated_at ON matter_memberships;
CREATE TRIGGER matter_memberships_set_updated_at
  BEFORE UPDATE ON matter_memberships
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS documents_set_updated_at ON documents;
CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS source_descriptors_set_updated_at ON source_descriptors;
CREATE TRIGGER source_descriptors_set_updated_at
  BEFORE UPDATE ON source_descriptors
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS skill_ideas_set_updated_at ON skill_ideas;
CREATE TRIGGER skill_ideas_set_updated_at
  BEFORE UPDATE ON skill_ideas
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS skill_samples_set_updated_at ON skill_samples;
CREATE TRIGGER skill_samples_set_updated_at
  BEFORE UPDATE ON skill_samples
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS configurable_skills_set_updated_at ON configurable_skills;
CREATE TRIGGER configurable_skills_set_updated_at
  BEFORE UPDATE ON configurable_skills
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS documents_tenant_matter_idx ON documents (tenant_id, matter_id);
CREATE INDEX IF NOT EXISTS document_blobs_document_idx ON document_blobs (document_id);
CREATE INDEX IF NOT EXISTS extraction_records_document_idx ON extraction_records (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS document_text_blocks_citation_idx ON document_text_blocks (matter_id, citation);
CREATE INDEX IF NOT EXISTS source_descriptors_matter_idx ON source_descriptors (matter_id, label_status);
CREATE INDEX IF NOT EXISTS processing_jobs_matter_idx ON processing_jobs (matter_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS provider_runs_matter_idx ON provider_runs (matter_id, task_class, started_at DESC);
CREATE INDEX IF NOT EXISTS incidents_matter_status_idx ON incidents (matter_id, status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_tenant_idx ON audit_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS skill_ideas_tenant_status_idx ON skill_ideas (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS skill_samples_idea_idx ON skill_samples (idea_id, version DESC);
