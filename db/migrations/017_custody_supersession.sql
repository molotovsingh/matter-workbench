-- Mark custody rows superseded when their materialized storage object is
-- tombstoned. extraction_records and source_descriptors are evidence rows:
-- they are never deleted, but rows whose storage object has been deleted
-- must not read as live custody.

ALTER TABLE extraction_records
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

ALTER TABLE source_descriptors
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

CREATE INDEX IF NOT EXISTS extraction_records_live_storage_object_idx
  ON extraction_records (tenant_id, matter_id, storage_object_id)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS source_descriptors_live_storage_object_idx
  ON source_descriptors (tenant_id, matter_id, storage_object_id)
  WHERE superseded_at IS NULL;
