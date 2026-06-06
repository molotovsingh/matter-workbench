-- Runtime DB payload custody for local/private DB mode.
--
-- Hosted/object-storage deployments can keep large bytes outside Postgres, but
-- the local runtime DB cutover needs a mode where a DB backup contains both the
-- custody ledger and the file/artifact bytes it points to. This table is
-- intentionally separate from storage_objects so the object ledger still works
-- for future object-storage providers.

CREATE TABLE IF NOT EXISTS storage_object_payloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  storage_object_id uuid NOT NULL,
  matter_id uuid REFERENCES matters(id),
  payload bytea NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  UNIQUE (tenant_id, storage_object_id),
  CHECK (octet_length(payload) = size_bytes)
);

CREATE UNIQUE INDEX IF NOT EXISTS storage_object_payloads_id_tenant_id_unique
  ON storage_object_payloads (id, tenant_id);
CREATE INDEX IF NOT EXISTS storage_object_payloads_matter_idx
  ON storage_object_payloads (matter_id, created_at DESC);

ALTER TABLE storage_object_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_object_payloads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS storage_object_payloads_tenant_isolation ON storage_object_payloads;
CREATE POLICY storage_object_payloads_tenant_isolation
  ON storage_object_payloads
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

DROP TRIGGER IF EXISTS storage_object_payloads_set_updated_at ON storage_object_payloads;
CREATE TRIGGER storage_object_payloads_set_updated_at
  BEFORE UPDATE ON storage_object_payloads
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storage_object_payloads_storage_object_tenant_fk') THEN
    ALTER TABLE storage_object_payloads
      ADD CONSTRAINT storage_object_payloads_storage_object_tenant_fk
      FOREIGN KEY (storage_object_id, tenant_id) REFERENCES storage_objects (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storage_object_payloads_matter_tenant_fk') THEN
    ALTER TABLE storage_object_payloads
      ADD CONSTRAINT storage_object_payloads_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;
END;
$$;
