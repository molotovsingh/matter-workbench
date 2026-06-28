-- Matter archive metadata for non-destructive close/reopen workflows.
-- This records why a matter was archived and who performed the lifecycle action.
-- It does not delete source files, generated artifacts, payload bytes, file IDs,
-- matter events, or history.

ALTER TABLE matters
  ADD COLUMN IF NOT EXISTS archive_reason text,
  ADD COLUMN IF NOT EXISTS archived_by_username text,
  ADD COLUMN IF NOT EXISTS archived_by_display_name text,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by_username text,
  ADD COLUMN IF NOT EXISTS reopened_by_display_name text;

ALTER TABLE matters
  DROP CONSTRAINT IF EXISTS matters_archive_reason_length;
ALTER TABLE matters
  ADD CONSTRAINT matters_archive_reason_length
  CHECK (archive_reason IS NULL OR char_length(archive_reason) <= 500);

ALTER TABLE matters
  DROP CONSTRAINT IF EXISTS matters_archived_by_username_length;
ALTER TABLE matters
  ADD CONSTRAINT matters_archived_by_username_length
  CHECK (archived_by_username IS NULL OR char_length(archived_by_username) <= 320);

ALTER TABLE matters
  DROP CONSTRAINT IF EXISTS matters_archived_by_display_name_length;
ALTER TABLE matters
  ADD CONSTRAINT matters_archived_by_display_name_length
  CHECK (archived_by_display_name IS NULL OR char_length(archived_by_display_name) <= 320);

ALTER TABLE matters
  DROP CONSTRAINT IF EXISTS matters_reopened_by_username_length;
ALTER TABLE matters
  ADD CONSTRAINT matters_reopened_by_username_length
  CHECK (reopened_by_username IS NULL OR char_length(reopened_by_username) <= 320);

ALTER TABLE matters
  DROP CONSTRAINT IF EXISTS matters_reopened_by_display_name_length;
ALTER TABLE matters
  ADD CONSTRAINT matters_reopened_by_display_name_length
  CHECK (reopened_by_display_name IS NULL OR char_length(reopened_by_display_name) <= 320);

CREATE INDEX IF NOT EXISTS matters_archived_lifecycle_idx
  ON matters (tenant_id, archived_at DESC)
  WHERE status = 'archived';
