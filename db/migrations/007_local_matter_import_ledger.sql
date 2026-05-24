-- Local matter import ledger for hosted beta migration.
-- This does not import files yet. It records a controlled batch and per-file
-- item map so existing local matter folders can later be moved without silent
-- renumbering, dropped warnings, or cross-tenant references.

CREATE TABLE IF NOT EXISTS matter_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL REFERENCES matters(id),
  created_by_user_id uuid REFERENCES users(id),
  source_kind text NOT NULL DEFAULT 'local_folder' CHECK (source_kind IN ('local_folder', 'zip_upload', 'object_storage', 'other')),
  source_label text NOT NULL,
  source_root_hint text,
  manifest_storage_object_id uuid,
  collision_policy text NOT NULL DEFAULT 'fail_closed' CHECK (collision_policy IN ('fail_closed', 'skip_duplicates', 'review_required')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'running', 'succeeded', 'partial_failed', 'failed', 'cancelled')),
  idempotency_key text NOT NULL,
  files_expected integer NOT NULL DEFAULT 0 CHECK (files_expected >= 0),
  files_imported integer NOT NULL DEFAULT 0 CHECK (files_imported >= 0),
  files_failed integer NOT NULL DEFAULT 0 CHECK (files_failed >= 0),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS matter_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  import_batch_id uuid NOT NULL REFERENCES matter_import_batches(id),
  matter_id uuid NOT NULL REFERENCES matters(id),
  document_id uuid REFERENCES documents(id),
  storage_object_id uuid REFERENCES storage_objects(id),
  original_file_id text,
  original_relative_path text NOT NULL,
  source_sha256 text,
  target_file_number integer CHECK (target_file_number IS NULL OR target_file_number > 0),
  target_file_id text,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'imported', 'skipped_duplicate', 'skipped_unsupported', 'failed', 'requires_review')),
  warning_code text,
  warning_message text,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, import_batch_id, original_relative_path)
);

CREATE UNIQUE INDEX IF NOT EXISTS matter_import_batches_id_tenant_id_unique
  ON matter_import_batches (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS matter_import_items_id_tenant_id_unique
  ON matter_import_items (id, tenant_id);

CREATE INDEX IF NOT EXISTS matter_import_batches_tenant_status_idx
  ON matter_import_batches (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS matter_import_batches_matter_idx
  ON matter_import_batches (matter_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS matter_import_items_batch_status_idx
  ON matter_import_items (import_batch_id, status, created_at);
CREATE INDEX IF NOT EXISTS matter_import_items_document_idx
  ON matter_import_items (document_id)
  WHERE document_id IS NOT NULL;

ALTER TABLE matter_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_import_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS matter_import_batches_tenant_isolation ON matter_import_batches;
CREATE POLICY matter_import_batches_tenant_isolation
  ON matter_import_batches
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE matter_import_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_import_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS matter_import_items_tenant_isolation ON matter_import_items;
CREATE POLICY matter_import_items_tenant_isolation
  ON matter_import_items
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

DROP TRIGGER IF EXISTS matter_import_batches_set_updated_at ON matter_import_batches;
CREATE TRIGGER matter_import_batches_set_updated_at
  BEFORE UPDATE ON matter_import_batches
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS matter_import_items_set_updated_at ON matter_import_items;
CREATE TRIGGER matter_import_items_set_updated_at
  BEFORE UPDATE ON matter_import_items
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_import_batches_matter_tenant_fk') THEN
    ALTER TABLE matter_import_batches
      ADD CONSTRAINT matter_import_batches_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_import_batches_created_by_tenant_member_fk') THEN
    ALTER TABLE matter_import_batches
      ADD CONSTRAINT matter_import_batches_created_by_tenant_member_fk
      FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES tenant_memberships (tenant_id, user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_import_batches_manifest_storage_object_tenant_fk') THEN
    ALTER TABLE matter_import_batches
      ADD CONSTRAINT matter_import_batches_manifest_storage_object_tenant_fk
      FOREIGN KEY (manifest_storage_object_id, tenant_id) REFERENCES storage_objects (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_import_items_batch_tenant_fk') THEN
    ALTER TABLE matter_import_items
      ADD CONSTRAINT matter_import_items_batch_tenant_fk
      FOREIGN KEY (import_batch_id, tenant_id) REFERENCES matter_import_batches (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_import_items_matter_tenant_fk') THEN
    ALTER TABLE matter_import_items
      ADD CONSTRAINT matter_import_items_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_import_items_document_tenant_fk') THEN
    ALTER TABLE matter_import_items
      ADD CONSTRAINT matter_import_items_document_tenant_fk
      FOREIGN KEY (document_id, tenant_id) REFERENCES documents (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_import_items_storage_object_tenant_fk') THEN
    ALTER TABLE matter_import_items
      ADD CONSTRAINT matter_import_items_storage_object_tenant_fk
      FOREIGN KEY (storage_object_id, tenant_id) REFERENCES storage_objects (id, tenant_id);
  END IF;
END;
$$;
