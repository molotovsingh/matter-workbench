-- Operator-only heartbeat and journey telemetry snapshots.

CREATE TABLE IF NOT EXISTS mothership_heartbeat_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  installation_id text NOT NULL REFERENCES mothership_installations(installation_id) ON DELETE RESTRICT,
  heartbeat_id text NOT NULL,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  UNIQUE (installation_id, heartbeat_id)
);

CREATE INDEX IF NOT EXISTS mothership_heartbeat_events_received_at_idx
  ON mothership_heartbeat_events (received_at DESC);
CREATE INDEX IF NOT EXISTS mothership_heartbeat_events_installation_id_idx
  ON mothership_heartbeat_events (installation_id, received_at DESC);
