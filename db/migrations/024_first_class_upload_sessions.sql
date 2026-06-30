-- First-class upload sessions: create durable session state before bytes move,
-- track each uploaded file independently, and allow commit to be retried without
-- relying on one browser-owned multipart request.

ALTER TABLE upload_sessions
  ALTER COLUMN matter_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'legacy_upload',
  ADD COLUMN IF NOT EXISTS matter_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS expected_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS received_file_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS received_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS committed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE upload_sessions
  DROP CONSTRAINT IF EXISTS upload_sessions_status_check;

ALTER TABLE upload_sessions
  ADD CONSTRAINT upload_sessions_status_check
  CHECK (status IN ('pending', 'uploading', 'uploaded', 'verified', 'committed', 'partial_failed', 'failed', 'cancelled'));

ALTER TABLE upload_sessions
  DROP CONSTRAINT IF EXISTS upload_sessions_action_check;

ALTER TABLE upload_sessions
  ADD CONSTRAINT upload_sessions_action_check
  CHECK (action IN ('legacy_upload', 'create_matter', 'add_files'));

ALTER TABLE upload_sessions
  DROP CONSTRAINT IF EXISTS upload_sessions_expected_bytes_check;

ALTER TABLE upload_sessions
  ADD CONSTRAINT upload_sessions_expected_bytes_check
  CHECK (expected_bytes >= 0);

ALTER TABLE upload_sessions
  DROP CONSTRAINT IF EXISTS upload_sessions_received_file_count_check;

ALTER TABLE upload_sessions
  ADD CONSTRAINT upload_sessions_received_file_count_check
  CHECK (received_file_count >= 0);

ALTER TABLE upload_sessions
  DROP CONSTRAINT IF EXISTS upload_sessions_received_bytes_check;

ALTER TABLE upload_sessions
  ADD CONSTRAINT upload_sessions_received_bytes_check
  CHECK (received_bytes >= 0);

CREATE INDEX IF NOT EXISTS upload_sessions_status_updated_idx
  ON upload_sessions (tenant_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS upload_sessions_set_updated_at ON upload_sessions;
CREATE TRIGGER upload_sessions_set_updated_at
  BEFORE UPDATE ON upload_sessions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS upload_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  upload_session_id uuid NOT NULL REFERENCES upload_sessions(id),
  file_index integer NOT NULL CHECK (file_index >= 0),
  relative_path text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL DEFAULT '',
  expected_size_bytes bigint NOT NULL DEFAULT 0 CHECK (expected_size_bytes >= 0),
  received_size_bytes bigint NOT NULL DEFAULT 0 CHECK (received_size_bytes >= 0),
  sha256 text,
  payload bytea,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'verified', 'committed', 'failed', 'cancelled')),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, upload_session_id, file_index),
  UNIQUE (tenant_id, upload_session_id, relative_path)
);

CREATE UNIQUE INDEX IF NOT EXISTS upload_session_items_id_tenant_id_unique
  ON upload_session_items (id, tenant_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upload_session_items_session_tenant_fk') THEN
    ALTER TABLE upload_session_items
      ADD CONSTRAINT upload_session_items_session_tenant_fk
      FOREIGN KEY (upload_session_id, tenant_id)
      REFERENCES upload_sessions (id, tenant_id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS upload_session_items_session_status_idx
  ON upload_session_items (tenant_id, upload_session_id, status, file_index);

DROP TRIGGER IF EXISTS upload_session_items_set_updated_at ON upload_session_items;
CREATE TRIGGER upload_session_items_set_updated_at
  BEFORE UPDATE ON upload_session_items
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

ALTER TABLE upload_session_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_session_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS upload_session_items_tenant_isolation ON upload_session_items;
CREATE POLICY upload_session_items_tenant_isolation ON upload_session_items
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());
