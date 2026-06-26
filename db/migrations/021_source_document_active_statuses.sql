-- Source active-set lifecycle statuses for future matter-custody removal.
-- This migration does not remove bytes and does not add a removal UI. It only
-- lets runtime DB source documents represent inactive active-record states using
-- the same vocabulary as the read-side suppression contract.

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_status_check;

ALTER TABLE documents
  ADD CONSTRAINT documents_status_check
  CHECK (status IN (
    'pending_upload',
    'uploaded',
    'verified',
    'duplicate',
    'unsupported',
    'failed',
    'removed_from_active_record',
    'quarantined',
    'deleted_pending',
    'deleted'
  ));

CREATE INDEX IF NOT EXISTS documents_active_source_status_idx
  ON documents (tenant_id, matter_id, status, file_id);
