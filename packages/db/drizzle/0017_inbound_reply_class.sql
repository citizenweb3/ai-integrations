-- Reply-classification slice (Phase 2 follow-up) — extend
-- `inbound_messages` with the structured reply-class signal so the new
-- `job.classify_reply` ADK stage has a deterministic place to land its
-- output. Without these columns the classification result is in-memory
-- only and downstream gates (warm draft eligibility, wrong_person
-- reassignment, not_now cooldown, unsubscribe → suppression) cannot read
-- a stable signal off the inbound row.
--
-- Taxonomy mirrors canonical §11.644-684 reply classes:
--   positive_interest | question | neutral | not_now | wrong_person
--   | unsubscribe | complaint | out_of_office | auto_reply | noise
-- Confidence taxonomy (low|medium|high) matches the research-snapshot
-- and contact-candidate confidence vocabulary already in use, so the
-- operator UI can reuse the same label helper.
--
-- All four columns are NULL by default — backfill is intentional.
-- A null `reply_class` means "not classified yet" (the classify_reply
-- job hasn't run, or the inbound is from before this slice). Code that
-- reads the field MUST treat null as "unknown", not as a class.

ALTER TABLE inbound_messages
  ADD COLUMN IF NOT EXISTS reply_class text,
  ADD COLUMN IF NOT EXISTS reply_class_confidence text,
  ADD COLUMN IF NOT EXISTS classified_at timestamptz,
  ADD COLUMN IF NOT EXISTS classify_agent_run_id uuid REFERENCES agent_runs(id);

ALTER TABLE inbound_messages
  DROP CONSTRAINT IF EXISTS inbound_messages_reply_class_check;
ALTER TABLE inbound_messages
  ADD CONSTRAINT inbound_messages_reply_class_check
  CHECK (reply_class IS NULL OR reply_class IN (
    'positive_interest','question','neutral','not_now','wrong_person',
    'unsubscribe','complaint','out_of_office','auto_reply','noise'
  ));

ALTER TABLE inbound_messages
  DROP CONSTRAINT IF EXISTS inbound_messages_reply_class_confidence_check;
ALTER TABLE inbound_messages
  ADD CONSTRAINT inbound_messages_reply_class_confidence_check
  CHECK (reply_class_confidence IS NULL OR reply_class_confidence IN ('low','medium','high'));

-- Lookup index for "give me the latest classified reply on this thread"
-- (warm draft gate + thread context panel). Partial on `thread_id IS NOT
-- NULL` since unmatched inbounds have no thread to gate against.
CREATE INDEX IF NOT EXISTS inbound_messages_thread_class_idx
  ON inbound_messages (thread_id, reply_class)
  WHERE thread_id IS NOT NULL;

-- Operator/observability index — "which inbounds are still unclassified"
-- so a backlog scanner / dashboard panel can surface them without a
-- table scan.
CREATE INDEX IF NOT EXISTS inbound_messages_unclassified_idx
  ON inbound_messages (thread_id, created_at)
  WHERE reply_class IS NULL AND thread_id IS NOT NULL;
