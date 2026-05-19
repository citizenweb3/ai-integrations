-- Global operator-controlled switches for incident response and future
-- low-cardinality runtime config. T-004 uses key='sends_paused'.

CREATE TABLE IF NOT EXISTS system_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_state_expires_at_idx
  ON system_state (expires_at);
