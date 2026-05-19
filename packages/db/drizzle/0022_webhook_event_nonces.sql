-- Svix signs each Resend webhook with a stable svix-id. Store seen ids before
-- ingestion so a captured signed body cannot be replayed inside the signature
-- drift window.

CREATE TABLE IF NOT EXISTS webhook_event_nonces (
  svix_id text PRIMARY KEY,
  seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_event_nonces_seen_at_idx
  ON webhook_event_nonces (seen_at);
