CREATE TABLE worker_heartbeats (
  worker_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'running',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE INDEX worker_heartbeats_last_seen_idx ON worker_heartbeats (last_seen_at);
