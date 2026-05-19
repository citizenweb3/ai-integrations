-- Outbound RFC822 Message-ID for header-based thread linkage
-- (canonical §8 / §44 — In-Reply-To / References must reference outbound MIDs)
ALTER TABLE outbound_messages
  ADD COLUMN IF NOT EXISTS rfc822_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS outbound_messages_rfc822_message_id_idx
  ON outbound_messages (rfc822_message_id)
  WHERE rfc822_message_id IS NOT NULL;

-- Inbound headers (Message-ID / In-Reply-To / References) for future
-- headers-first thread matching (canonical §8.466-468 / §44.4914-4921)
ALTER TABLE inbound_messages
  ADD COLUMN IF NOT EXISTS rfc822_message_id text;

ALTER TABLE inbound_messages
  ADD COLUMN IF NOT EXISTS in_reply_to text;

ALTER TABLE inbound_messages
  ADD COLUMN IF NOT EXISTS references_json jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS inbound_messages_rfc822_message_id_idx
  ON inbound_messages (rfc822_message_id)
  WHERE rfc822_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inbound_messages_in_reply_to_idx
  ON inbound_messages (in_reply_to)
  WHERE in_reply_to IS NOT NULL;
