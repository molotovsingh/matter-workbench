-- Canonical matter event ledger foundation.
-- This is the app-owned append-only event source for durable Matter Log events.
-- It is deliberately separate from audit_events and job ledgers: audit/jobs can
-- explain activity, but matter_events is the long-term matter mutation record.

CREATE TABLE IF NOT EXISTS matter_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid REFERENCES matters(id),
  matter_name text NOT NULL DEFAULT '',
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  summary_key text NOT NULL DEFAULT '' CHECK (summary_key = '' OR summary_key ~ '^[a-z][a-z0-9_]*$'),
  actor_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  object_type text NOT NULL DEFAULT '' CHECK (object_type = '' OR object_type ~ '^[a-z][a-z0-9_]*$'),
  object_id text NOT NULL DEFAULT '',
  object_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS matter_events_id_tenant_id_unique
  ON matter_events (id, tenant_id);

CREATE INDEX IF NOT EXISTS matter_events_matter_occurred_idx
  ON matter_events (tenant_id, matter_id, occurred_at DESC)
  WHERE matter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS matter_events_matter_name_occurred_idx
  ON matter_events (tenant_id, matter_name, occurred_at DESC)
  WHERE matter_name <> '';

CREATE INDEX IF NOT EXISTS matter_events_type_occurred_idx
  ON matter_events (tenant_id, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS matter_events_object_idx
  ON matter_events (tenant_id, object_type, object_id)
  WHERE object_type <> '' AND object_id <> '';

ALTER TABLE matter_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS matter_events_tenant_isolation ON matter_events;
CREATE POLICY matter_events_tenant_isolation
  ON matter_events
  USING (tenant_id = current_app_tenant_id())
  WITH CHECK (tenant_id = current_app_tenant_id());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_events_matter_tenant_fk') THEN
    ALTER TABLE matter_events
      ADD CONSTRAINT matter_events_matter_tenant_fk
      FOREIGN KEY (matter_id, tenant_id) REFERENCES matters (id, tenant_id);
  END IF;
END $$;
