-- Storage object lifecycle for hosted beta.
-- Existing tables keep their object_key columns for compatibility. This ledger
-- gives hosted workers one tenant-scoped custody record for originals,
-- extraction payloads, text payloads, generated artifacts, exports, and cleanup
-- candidates.

CREATE TABLE IF NOT EXISTS storage_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid REFERENCES matters(id),
  object_key text NOT NULL,
  bucket text,
  storage_provider text NOT NULL DEFAULT 'unconfigured',
  object_role text NOT NULL CHECK (object_role IN ('source_original', 'source_working_copy', 'extraction_payload', 'text_block_payload', 'matter_artifact', 'skill_sample', 'export', 'temporary', 'other')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'uploading', 'uploaded', 'verified', 'failed', 'orphaned', 'deleted_pending', 'deleted')),
  mime_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  sha256 text,
  idempotency_key text,
  created_by_job_id uuid REFERENCES processing_jobs(id),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz,
  verified_at timestamptz,
  orphaned_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (tenant_id, object_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS storage_objects_id_tenant_id_unique ON storage_objects (id, tenant_id);
CREATE INDEX IF NOT EXISTS storage_objects_tenant_state_idx ON storage_objects (tenant_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS storage_objects_matter_role_idx ON storage_objects (matter_id, object_role, state);
CREATE INDEX IF NOT EXISTS storage_objects_idempotency_idx ON storage_objects (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE storage_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_objects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS storage_objects_tenant_isolation ON storage_objects;
CREATE POLICY storage_objects_tenant_isolation
  ON storage_objects
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

DROP TRIGGER IF EXISTS storage_objects_set_updated_at ON storage_objects;
CREATE TRIGGER storage_objects_set_updated_at
  BEFORE UPDATE ON storage_objects
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

ALTER TABLE document_blobs
  ADD COLUMN IF NOT EXISTS storage_object_id uuid;
ALTER TABLE extraction_records
  ADD COLUMN IF NOT EXISTS storage_object_id uuid;
ALTER TABLE document_text_blocks
  ADD COLUMN IF NOT EXISTS storage_object_id uuid;
ALTER TABLE matter_artifacts
  ADD COLUMN IF NOT EXISTS storage_object_id uuid;
ALTER TABLE skill_samples
  ADD COLUMN IF NOT EXISTS storage_object_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storage_objects_matter_tenant_fk') THEN
    ALTER TABLE storage_objects
      ADD CONSTRAINT storage_objects_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storage_objects_job_tenant_fk') THEN
    ALTER TABLE storage_objects
      ADD CONSTRAINT storage_objects_job_tenant_fk
      FOREIGN KEY (created_by_job_id, tenant_id) REFERENCES processing_jobs (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_blobs_storage_object_tenant_fk') THEN
    ALTER TABLE document_blobs
      ADD CONSTRAINT document_blobs_storage_object_tenant_fk
      FOREIGN KEY (storage_object_id, tenant_id) REFERENCES storage_objects (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'extraction_records_storage_object_tenant_fk') THEN
    ALTER TABLE extraction_records
      ADD CONSTRAINT extraction_records_storage_object_tenant_fk
      FOREIGN KEY (storage_object_id, tenant_id) REFERENCES storage_objects (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_text_blocks_storage_object_tenant_fk') THEN
    ALTER TABLE document_text_blocks
      ADD CONSTRAINT document_text_blocks_storage_object_tenant_fk
      FOREIGN KEY (storage_object_id, tenant_id) REFERENCES storage_objects (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_artifacts_storage_object_tenant_fk') THEN
    ALTER TABLE matter_artifacts
      ADD CONSTRAINT matter_artifacts_storage_object_tenant_fk
      FOREIGN KEY (storage_object_id, tenant_id) REFERENCES storage_objects (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'skill_samples_storage_object_tenant_fk') THEN
    ALTER TABLE skill_samples
      ADD CONSTRAINT skill_samples_storage_object_tenant_fk
      FOREIGN KEY (storage_object_id, tenant_id) REFERENCES storage_objects (id, tenant_id);
  END IF;
END;
$$;
