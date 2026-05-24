-- Tenant row-level security prep for hosted beta.
-- The local V1 runtime does not use Postgres yet. This migration prepares the
-- hosted control plane so tenant-scoped rows are invisible unless the database
-- session explicitly sets app.tenant_id.

CREATE OR REPLACE FUNCTION current_app_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid;
$$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenants_tenant_isolation ON tenants;
CREATE POLICY tenants_tenant_isolation
  ON tenants
  USING (id = current_app_tenant_id())
  WITH CHECK (id = current_app_tenant_id());

ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_memberships_tenant_isolation ON tenant_memberships;
CREATE POLICY tenant_memberships_tenant_isolation
  ON tenant_memberships
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE matters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS matters_tenant_isolation ON matters;
CREATE POLICY matters_tenant_isolation
  ON matters
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE matter_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS matter_memberships_tenant_isolation ON matter_memberships;
CREATE POLICY matter_memberships_tenant_isolation
  ON matter_memberships
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE matter_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_intakes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS matter_intakes_tenant_isolation ON matter_intakes;
CREATE POLICY matter_intakes_tenant_isolation
  ON matter_intakes
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS upload_sessions_tenant_isolation ON upload_sessions;
CREATE POLICY upload_sessions_tenant_isolation
  ON upload_sessions
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS documents_tenant_isolation ON documents;
CREATE POLICY documents_tenant_isolation
  ON documents
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE document_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_blobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_blobs_tenant_isolation ON document_blobs;
CREATE POLICY document_blobs_tenant_isolation
  ON document_blobs
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE extraction_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS extraction_records_tenant_isolation ON extraction_records;
CREATE POLICY extraction_records_tenant_isolation
  ON extraction_records
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE document_text_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_text_blocks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_text_blocks_tenant_isolation ON document_text_blocks;
CREATE POLICY document_text_blocks_tenant_isolation
  ON document_text_blocks
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE source_descriptors ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_descriptors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS source_descriptors_tenant_isolation ON source_descriptors;
CREATE POLICY source_descriptors_tenant_isolation
  ON source_descriptors
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS processing_jobs_tenant_isolation ON processing_jobs;
CREATE POLICY processing_jobs_tenant_isolation
  ON processing_jobs
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE job_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_outbox_tenant_isolation ON job_outbox;
CREATE POLICY job_outbox_tenant_isolation
  ON job_outbox
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE provider_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_runs_tenant_isolation ON provider_runs;
CREATE POLICY provider_runs_tenant_isolation
  ON provider_runs
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE matter_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_artifacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS matter_artifacts_tenant_isolation ON matter_artifacts;
CREATE POLICY matter_artifacts_tenant_isolation
  ON matter_artifacts
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE artifact_validation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_validation_results FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS artifact_validation_results_tenant_isolation ON artifact_validation_results;
CREATE POLICY artifact_validation_results_tenant_isolation
  ON artifact_validation_results
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incidents_tenant_isolation ON incidents;
CREATE POLICY incidents_tenant_isolation
  ON incidents
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE attention_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE attention_acknowledgements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attention_acknowledgements_tenant_isolation ON attention_acknowledgements;
CREATE POLICY attention_acknowledgements_tenant_isolation
  ON attention_acknowledgements
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE preparation_advisory_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE preparation_advisory_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS preparation_advisory_snapshots_tenant_isolation ON preparation_advisory_snapshots;
CREATE POLICY preparation_advisory_snapshots_tenant_isolation
  ON preparation_advisory_snapshots
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE cost_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_events_tenant_isolation ON cost_events;
CREATE POLICY cost_events_tenant_isolation
  ON cost_events
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_tenant_isolation ON audit_events;
CREATE POLICY audit_events_tenant_isolation
  ON audit_events
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE skill_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_ideas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS skill_ideas_tenant_isolation ON skill_ideas;
CREATE POLICY skill_ideas_tenant_isolation
  ON skill_ideas
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE skill_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_samples FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS skill_samples_tenant_isolation ON skill_samples;
CREATE POLICY skill_samples_tenant_isolation
  ON skill_samples
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE configurable_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE configurable_skills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS configurable_skills_tenant_isolation ON configurable_skills;
CREATE POLICY configurable_skills_tenant_isolation
  ON configurable_skills
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE configurable_skill_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE configurable_skill_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS configurable_skill_versions_tenant_isolation ON configurable_skill_versions;
CREATE POLICY configurable_skill_versions_tenant_isolation
  ON configurable_skill_versions
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE configurable_skill_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE configurable_skill_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS configurable_skill_runs_tenant_isolation ON configurable_skill_runs;
CREATE POLICY configurable_skill_runs_tenant_isolation
  ON configurable_skill_runs
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());
