-- Tenant reference integrity for hosted beta.
-- RLS hides rows by their own tenant_id. These constraints also prevent a row
-- from pointing at a parent row owned by a different tenant.

CREATE UNIQUE INDEX IF NOT EXISTS matters_id_tenant_id_unique ON matters (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS matter_intakes_id_tenant_id_unique ON matter_intakes (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS upload_sessions_id_tenant_id_unique ON upload_sessions (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS documents_id_tenant_id_unique ON documents (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS document_blobs_id_tenant_id_unique ON document_blobs (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS extraction_records_id_tenant_id_unique ON extraction_records (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS processing_jobs_id_tenant_id_unique ON processing_jobs (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS provider_runs_id_tenant_id_unique ON provider_runs (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS matter_artifacts_id_tenant_id_unique ON matter_artifacts (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS artifact_validation_results_id_tenant_id_unique ON artifact_validation_results (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS incidents_id_tenant_id_unique ON incidents (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS skill_ideas_id_tenant_id_unique ON skill_ideas (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS configurable_skills_id_tenant_id_unique ON configurable_skills (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS configurable_skill_versions_id_tenant_id_unique ON configurable_skill_versions (id, tenant_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_memberships_matter_tenant_fk') THEN
    ALTER TABLE matter_memberships
      ADD CONSTRAINT matter_memberships_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_intakes_matter_tenant_fk') THEN
    ALTER TABLE matter_intakes
      ADD CONSTRAINT matter_intakes_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upload_sessions_matter_tenant_fk') THEN
    ALTER TABLE upload_sessions
      ADD CONSTRAINT upload_sessions_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upload_sessions_intake_tenant_fk') THEN
    ALTER TABLE upload_sessions
      ADD CONSTRAINT upload_sessions_intake_tenant_fk
      FOREIGN KEY (intake_id, tenant_id) REFERENCES matter_intakes (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_matter_tenant_fk') THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_intake_tenant_fk') THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_intake_tenant_fk
      FOREIGN KEY (intake_id, tenant_id) REFERENCES matter_intakes (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_upload_session_tenant_fk') THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_upload_session_tenant_fk
      FOREIGN KEY (upload_session_id, tenant_id) REFERENCES upload_sessions (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_duplicate_tenant_fk') THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_duplicate_tenant_fk
      FOREIGN KEY (duplicate_of_document_id, tenant_id) REFERENCES documents (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_blobs_matter_tenant_fk') THEN
    ALTER TABLE document_blobs
      ADD CONSTRAINT document_blobs_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_blobs_document_tenant_fk') THEN
    ALTER TABLE document_blobs
      ADD CONSTRAINT document_blobs_document_tenant_fk
      FOREIGN KEY (document_id, tenant_id) REFERENCES documents (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'extraction_records_matter_tenant_fk') THEN
    ALTER TABLE extraction_records
      ADD CONSTRAINT extraction_records_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'extraction_records_document_tenant_fk') THEN
    ALTER TABLE extraction_records
      ADD CONSTRAINT extraction_records_document_tenant_fk
      FOREIGN KEY (document_id, tenant_id) REFERENCES documents (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'extraction_records_blob_tenant_fk') THEN
    ALTER TABLE extraction_records
      ADD CONSTRAINT extraction_records_blob_tenant_fk
      FOREIGN KEY (document_blob_id, tenant_id) REFERENCES document_blobs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_text_blocks_matter_tenant_fk') THEN
    ALTER TABLE document_text_blocks
      ADD CONSTRAINT document_text_blocks_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_text_blocks_document_tenant_fk') THEN
    ALTER TABLE document_text_blocks
      ADD CONSTRAINT document_text_blocks_document_tenant_fk
      FOREIGN KEY (document_id, tenant_id) REFERENCES documents (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_text_blocks_extraction_tenant_fk') THEN
    ALTER TABLE document_text_blocks
      ADD CONSTRAINT document_text_blocks_extraction_tenant_fk
      FOREIGN KEY (extraction_record_id, tenant_id) REFERENCES extraction_records (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_descriptors_matter_tenant_fk') THEN
    ALTER TABLE source_descriptors
      ADD CONSTRAINT source_descriptors_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_descriptors_document_tenant_fk') THEN
    ALTER TABLE source_descriptors
      ADD CONSTRAINT source_descriptors_document_tenant_fk
      FOREIGN KEY (document_id, tenant_id) REFERENCES documents (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_descriptors_extraction_tenant_fk') THEN
    ALTER TABLE source_descriptors
      ADD CONSTRAINT source_descriptors_extraction_tenant_fk
      FOREIGN KEY (extraction_record_id, tenant_id) REFERENCES extraction_records (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_descriptors_provider_run_tenant_fk') THEN
    ALTER TABLE source_descriptors
      ADD CONSTRAINT source_descriptors_provider_run_tenant_fk
      FOREIGN KEY (provider_run_id, tenant_id) REFERENCES provider_runs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processing_jobs_matter_tenant_fk') THEN
    ALTER TABLE processing_jobs
      ADD CONSTRAINT processing_jobs_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_outbox_job_tenant_fk') THEN
    ALTER TABLE job_outbox
      ADD CONSTRAINT job_outbox_job_tenant_fk
      FOREIGN KEY (job_id, tenant_id) REFERENCES processing_jobs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_runs_matter_tenant_fk') THEN
    ALTER TABLE provider_runs
      ADD CONSTRAINT provider_runs_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_runs_job_tenant_fk') THEN
    ALTER TABLE provider_runs
      ADD CONSTRAINT provider_runs_job_tenant_fk
      FOREIGN KEY (job_id, tenant_id) REFERENCES processing_jobs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_artifacts_matter_tenant_fk') THEN
    ALTER TABLE matter_artifacts
      ADD CONSTRAINT matter_artifacts_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_artifacts_job_tenant_fk') THEN
    ALTER TABLE matter_artifacts
      ADD CONSTRAINT matter_artifacts_job_tenant_fk
      FOREIGN KEY (created_by_job_id, tenant_id) REFERENCES processing_jobs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_artifacts_source_artifact_tenant_fk') THEN
    ALTER TABLE matter_artifacts
      ADD CONSTRAINT matter_artifacts_source_artifact_tenant_fk
      FOREIGN KEY (source_artifact_id, tenant_id) REFERENCES matter_artifacts (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_runs_input_artifact_tenant_fk') THEN
    ALTER TABLE provider_runs
      ADD CONSTRAINT provider_runs_input_artifact_tenant_fk
      FOREIGN KEY (input_artifact_id, tenant_id) REFERENCES matter_artifacts (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_runs_output_artifact_tenant_fk') THEN
    ALTER TABLE provider_runs
      ADD CONSTRAINT provider_runs_output_artifact_tenant_fk
      FOREIGN KEY (output_artifact_id, tenant_id) REFERENCES matter_artifacts (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artifact_validation_matter_tenant_fk') THEN
    ALTER TABLE artifact_validation_results
      ADD CONSTRAINT artifact_validation_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artifact_validation_artifact_tenant_fk') THEN
    ALTER TABLE artifact_validation_results
      ADD CONSTRAINT artifact_validation_artifact_tenant_fk
      FOREIGN KEY (artifact_id, tenant_id) REFERENCES matter_artifacts (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artifact_validation_job_tenant_fk') THEN
    ALTER TABLE artifact_validation_results
      ADD CONSTRAINT artifact_validation_job_tenant_fk
      FOREIGN KEY (created_by_job_id, tenant_id) REFERENCES processing_jobs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incidents_matter_tenant_fk') THEN
    ALTER TABLE incidents
      ADD CONSTRAINT incidents_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attention_acknowledgements_matter_tenant_fk') THEN
    ALTER TABLE attention_acknowledgements
      ADD CONSTRAINT attention_acknowledgements_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attention_acknowledgements_incident_tenant_fk') THEN
    ALTER TABLE attention_acknowledgements
      ADD CONSTRAINT attention_acknowledgements_incident_tenant_fk
      FOREIGN KEY (incident_id, tenant_id) REFERENCES incidents (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'preparation_advisory_snapshots_matter_tenant_fk') THEN
    ALTER TABLE preparation_advisory_snapshots
      ADD CONSTRAINT preparation_advisory_snapshots_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'preparation_advisory_snapshots_preparation_job_tenant_fk') THEN
    ALTER TABLE preparation_advisory_snapshots
      ADD CONSTRAINT preparation_advisory_snapshots_preparation_job_tenant_fk
      FOREIGN KEY (preparation_run_id, tenant_id) REFERENCES processing_jobs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'preparation_advisory_snapshots_generated_job_tenant_fk') THEN
    ALTER TABLE preparation_advisory_snapshots
      ADD CONSTRAINT preparation_advisory_snapshots_generated_job_tenant_fk
      FOREIGN KEY (generated_by_job_id, tenant_id) REFERENCES processing_jobs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_events_matter_tenant_fk') THEN
    ALTER TABLE cost_events
      ADD CONSTRAINT cost_events_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_events_provider_run_tenant_fk') THEN
    ALTER TABLE cost_events
      ADD CONSTRAINT cost_events_provider_run_tenant_fk
      FOREIGN KEY (provider_run_id, tenant_id) REFERENCES provider_runs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_events_job_tenant_fk') THEN
    ALTER TABLE cost_events
      ADD CONSTRAINT cost_events_job_tenant_fk
      FOREIGN KEY (job_id, tenant_id) REFERENCES processing_jobs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_events_matter_tenant_fk') THEN
    ALTER TABLE audit_events
      ADD CONSTRAINT audit_events_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'skill_ideas_matter_tenant_fk') THEN
    ALTER TABLE skill_ideas
      ADD CONSTRAINT skill_ideas_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'skill_samples_idea_tenant_fk') THEN
    ALTER TABLE skill_samples
      ADD CONSTRAINT skill_samples_idea_tenant_fk
      FOREIGN KEY (idea_id, tenant_id) REFERENCES skill_ideas (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'skill_samples_matter_tenant_fk') THEN
    ALTER TABLE skill_samples
      ADD CONSTRAINT skill_samples_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'skill_samples_provider_run_tenant_fk') THEN
    ALTER TABLE skill_samples
      ADD CONSTRAINT skill_samples_provider_run_tenant_fk
      FOREIGN KEY (ai_run_id, tenant_id) REFERENCES provider_runs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'configurable_skill_versions_skill_tenant_fk') THEN
    ALTER TABLE configurable_skill_versions
      ADD CONSTRAINT configurable_skill_versions_skill_tenant_fk
      FOREIGN KEY (skill_id, tenant_id) REFERENCES configurable_skills (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'configurable_skill_versions_sample_artifact_tenant_fk') THEN
    ALTER TABLE configurable_skill_versions
      ADD CONSTRAINT configurable_skill_versions_sample_artifact_tenant_fk
      FOREIGN KEY (sample_artifact_id, tenant_id) REFERENCES matter_artifacts (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'configurable_skills_current_version_tenant_fk') THEN
    ALTER TABLE configurable_skills
      ADD CONSTRAINT configurable_skills_current_version_tenant_fk
      FOREIGN KEY (current_version_id, tenant_id) REFERENCES configurable_skill_versions (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'configurable_skill_runs_matter_tenant_fk') THEN
    ALTER TABLE configurable_skill_runs
      ADD CONSTRAINT configurable_skill_runs_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'configurable_skill_runs_skill_tenant_fk') THEN
    ALTER TABLE configurable_skill_runs
      ADD CONSTRAINT configurable_skill_runs_skill_tenant_fk
      FOREIGN KEY (skill_id, tenant_id) REFERENCES configurable_skills (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'configurable_skill_runs_skill_version_tenant_fk') THEN
    ALTER TABLE configurable_skill_runs
      ADD CONSTRAINT configurable_skill_runs_skill_version_tenant_fk
      FOREIGN KEY (skill_version_id, tenant_id) REFERENCES configurable_skill_versions (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'configurable_skill_runs_job_tenant_fk') THEN
    ALTER TABLE configurable_skill_runs
      ADD CONSTRAINT configurable_skill_runs_job_tenant_fk
      FOREIGN KEY (job_id, tenant_id) REFERENCES processing_jobs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'configurable_skill_runs_provider_run_tenant_fk') THEN
    ALTER TABLE configurable_skill_runs
      ADD CONSTRAINT configurable_skill_runs_provider_run_tenant_fk
      FOREIGN KEY (provider_run_id, tenant_id) REFERENCES provider_runs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'configurable_skill_runs_output_artifact_tenant_fk') THEN
    ALTER TABLE configurable_skill_runs
      ADD CONSTRAINT configurable_skill_runs_output_artifact_tenant_fk
      FOREIGN KEY (output_artifact_id, tenant_id) REFERENCES matter_artifacts (id, tenant_id);
  END IF;
END;
$$;
