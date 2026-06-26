-- Artifact currentness projection foundation for future source-custody mutations.
-- This migration does not regenerate artifacts, remove source files, or expose a
-- removal UI. It creates a durable place for source-removal and refresh flows to
-- mark source-backed outputs current, stale, missing, blocked, or needing review.

CREATE TABLE IF NOT EXISTS matter_artifact_currentness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL REFERENCES matters(id),
  artifact_id uuid REFERENCES matter_artifacts(id),
  artifact_family text NOT NULL CHECK (artifact_family IN (
    'source_index',
    'list_of_dates',
    'matter_story',
    'custom_skill_output'
  )),
  artifact_path text NOT NULL DEFAULT '',
  state text NOT NULL CHECK (state IN (
    'current',
    'stale',
    'missing',
    'failed',
    'missing_upstream',
    'needs_review',
    'unknown'
  )),
  dependency_state text NOT NULL DEFAULT '' CHECK (dependency_state IN (
    '',
    'label_refresh_needed',
    'chronology_review_needed',
    'chronology_regeneration_needed',
    'source_set_changed',
    'source_set_review_needed'
  )),
  reason_code text NOT NULL DEFAULT '' CHECK (reason_code = '' OR reason_code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  source_event_id uuid,
  affected_file_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(affected_file_ids_json) = 'array'),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata_json) = 'object'),
  observed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, matter_id, artifact_family, artifact_path)
);

CREATE INDEX IF NOT EXISTS matter_artifact_currentness_matter_idx
  ON matter_artifact_currentness (tenant_id, matter_id, artifact_family, state, updated_at DESC);

CREATE INDEX IF NOT EXISTS matter_artifact_currentness_source_event_idx
  ON matter_artifact_currentness (tenant_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

ALTER TABLE matter_artifact_currentness ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_artifact_currentness FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS matter_artifact_currentness_tenant_isolation ON matter_artifact_currentness;
CREATE POLICY matter_artifact_currentness_tenant_isolation
  ON matter_artifact_currentness
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_artifact_currentness_matter_tenant_fk') THEN
    ALTER TABLE matter_artifact_currentness
      ADD CONSTRAINT matter_artifact_currentness_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_artifact_currentness_artifact_tenant_fk') THEN
    ALTER TABLE matter_artifact_currentness
      ADD CONSTRAINT matter_artifact_currentness_artifact_tenant_fk
      FOREIGN KEY (artifact_id, tenant_id) REFERENCES matter_artifacts (id, tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_artifact_currentness_source_event_tenant_fk') THEN
    ALTER TABLE matter_artifact_currentness
      ADD CONSTRAINT matter_artifact_currentness_source_event_tenant_fk
      FOREIGN KEY (source_event_id, tenant_id) REFERENCES matter_events (id, tenant_id);
  END IF;
END $$;
