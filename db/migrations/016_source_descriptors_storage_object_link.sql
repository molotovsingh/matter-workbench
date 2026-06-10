-- Link Source Index descriptors to their materialized storage object.
-- Runtime DB storage persists generated Source Index artifacts through the
-- same custody ledger used by extraction records and matter artifacts. This
-- migration closes the schema gap for source_descriptors without editing the
-- already-applied 005 migration.

ALTER TABLE source_descriptors
  ADD COLUMN IF NOT EXISTS storage_object_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_descriptors_storage_object_tenant_fk') THEN
    ALTER TABLE source_descriptors
      ADD CONSTRAINT source_descriptors_storage_object_tenant_fk
      FOREIGN KEY (storage_object_id, tenant_id) REFERENCES storage_objects (id, tenant_id);
  END IF;
END;
$$;
