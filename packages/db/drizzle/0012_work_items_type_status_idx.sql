-- Compound index on (type, status) for guardrail-time lookups like
-- `where type = 'send_ambiguity_review' and status = 'open'`. The existing
-- `work_items_status_priority_idx` covers (status, priority, available_at)
-- which forces a type-filter scan over every open work item; that scales
-- poorly as work_items grows because Phase 5 guardrails run this query on
-- every approve-and-send attempt.
CREATE INDEX IF NOT EXISTS "work_items_type_status_idx"
  ON "work_items" ("type", "status");
