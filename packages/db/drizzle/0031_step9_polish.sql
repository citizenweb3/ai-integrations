ALTER TABLE inbound_messages
  ADD COLUMN IF NOT EXISTS attachments_json jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE threads
  ADD COLUMN IF NOT EXISTS merged_into_thread_id uuid REFERENCES threads(id);

CREATE INDEX IF NOT EXISTS inbound_messages_from_created_idx
  ON inbound_messages (from_email, created_at);

CREATE INDEX IF NOT EXISTS outbound_messages_recipient_created_idx
  ON outbound_messages (recipient_email, created_at);

CREATE INDEX IF NOT EXISTS threads_merged_into_idx
  ON threads (merged_into_thread_id)
  WHERE merged_into_thread_id IS NOT NULL;
