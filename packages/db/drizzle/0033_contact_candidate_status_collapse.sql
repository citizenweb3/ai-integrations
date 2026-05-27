-- S5.6 / G5.4: collapse the unused `approved` contact-candidate status.
-- Approval always materialized the contact in one step (pending -> converted),
-- so no row ever reached `approved` — the slot was dead. Defensive remap first:
-- the pre-0033 unique index already guaranteed at most one active row per
-- (organization_id, lower(email)) across pending+approved, so moving any stray
-- `approved` row to `pending` cannot collide with the rebuilt pending-only
-- index. In practice this UPDATE touches zero rows.
UPDATE research_contact_candidates
SET status = 'pending', updated_at = now()
WHERE status = 'approved';

ALTER TABLE research_contact_candidates
  DROP CONSTRAINT IF EXISTS research_contact_candidates_status_check;

ALTER TABLE research_contact_candidates
  ADD CONSTRAINT research_contact_candidates_status_check
  CHECK (status IN ('pending', 'rejected', 'converted'));

-- With `approved` gone, "active" candidate == pending. Narrow the partial
-- index predicates accordingly (mirrors 0016 / 0029, minus the dead status).
DROP INDEX IF EXISTS research_contact_candidates_org_email_active_idx;
CREATE UNIQUE INDEX IF NOT EXISTS research_contact_candidates_org_email_active_idx
  ON research_contact_candidates (organization_id, lower(email))
  WHERE email IS NOT NULL AND status = 'pending';

DROP INDEX IF EXISTS research_contact_candidates_org_name_active_idx;
CREATE INDEX IF NOT EXISTS research_contact_candidates_org_name_active_idx
  ON research_contact_candidates (organization_id, lower(full_name))
  WHERE email IS NULL AND status = 'pending';
