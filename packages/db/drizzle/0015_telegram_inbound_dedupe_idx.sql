-- Phase 5 Telegram T3 — partial unique expression index on event_log so the
-- `telegram_inbound_received` dedup is enforced at the database level
-- (read-then-insert under READ COMMITTED is racy; concurrent webhook
-- deliveries with the same update_id need a hard uniqueness gate). The same
-- index also makes the dedup lookup O(log N) instead of a sequential scan
-- across the full event_log.

CREATE UNIQUE INDEX IF NOT EXISTS event_log_telegram_inbound_dedupe_idx
  ON event_log ((payload_json->>'dedupeKey'))
  WHERE event_type = 'telegram_inbound_received';
