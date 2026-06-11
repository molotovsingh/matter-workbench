-- Operator-only deployment portability and backend suitability snapshots.

CREATE TABLE IF NOT EXISTS mothership_metric_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  installation_id text NOT NULL REFERENCES mothership_installations(installation_id) ON DELETE RESTRICT,
  snapshot_id text NOT NULL,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  UNIQUE (installation_id, snapshot_id)
);

CREATE INDEX IF NOT EXISTS mothership_metric_snapshots_received_at_idx
  ON mothership_metric_snapshots (received_at DESC);
CREATE INDEX IF NOT EXISTS mothership_metric_snapshots_installation_id_idx
  ON mothership_metric_snapshots (installation_id, received_at DESC);
