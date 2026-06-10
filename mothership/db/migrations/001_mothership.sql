-- Operator-only central ledger for Matter Workbench private beta telemetry.
-- This database is intentionally independent from legal matter storage.

CREATE TABLE IF NOT EXISTS mothership_installations (
  installation_id text PRIMARY KEY,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS mothership_ingestion_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  installation_id text NOT NULL REFERENCES mothership_installations(installation_id) ON DELETE CASCADE,
  token_sha256 text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS mothership_ingestion_tokens_installation_id_idx
  ON mothership_ingestion_tokens (installation_id);

CREATE TABLE IF NOT EXISTS mothership_feedback_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  installation_id text NOT NULL REFERENCES mothership_installations(installation_id) ON DELETE RESTRICT,
  feedback_id text NOT NULL,
  classification text NOT NULL,
  status text NOT NULL,
  matter_name text,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  UNIQUE (installation_id, feedback_id)
);

CREATE INDEX IF NOT EXISTS mothership_feedback_events_received_at_idx
  ON mothership_feedback_events (received_at DESC);
CREATE INDEX IF NOT EXISTS mothership_feedback_events_classification_idx
  ON mothership_feedback_events (classification, received_at DESC);
CREATE INDEX IF NOT EXISTS mothership_feedback_events_installation_id_idx
  ON mothership_feedback_events (installation_id, received_at DESC);

CREATE TABLE IF NOT EXISTS mothership_signal_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  installation_id text NOT NULL REFERENCES mothership_installations(installation_id) ON DELETE RESTRICT,
  signal_id text NOT NULL,
  source text NOT NULL,
  severity text NOT NULL,
  fingerprint text NOT NULL,
  matter_name text,
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  UNIQUE (installation_id, signal_id)
);

CREATE INDEX IF NOT EXISTS mothership_signal_events_received_at_idx
  ON mothership_signal_events (received_at DESC);
CREATE INDEX IF NOT EXISTS mothership_signal_events_severity_idx
  ON mothership_signal_events (severity, received_at DESC);
CREATE INDEX IF NOT EXISTS mothership_signal_events_fingerprint_idx
  ON mothership_signal_events (installation_id, fingerprint);
CREATE INDEX IF NOT EXISTS mothership_signal_events_installation_id_idx
  ON mothership_signal_events (installation_id, received_at DESC);
