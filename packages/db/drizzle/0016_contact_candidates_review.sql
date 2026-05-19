-- Phase 1 contact-candidates pipeline (slice C1) — promote
-- `research_contact_candidates` from a skeletal table to an operator-review
-- queue. Adds the lifecycle status, evidence/source provenance, agent_run
-- linkage so we can trace which research run produced each candidate, and
-- the converted_contact_id back-pointer so an approved candidate is
-- traceable to the `contacts` row it became.
--
-- Dedupe semantics: the partial unique index gates against double-emit of
-- the same (org, email) while a candidate is still actionable
-- (pending/approved). A `rejected` candidate is intentionally NOT covered
-- so a future research run can re-surface the same email if the operator
-- wants a second look. A `converted` candidate is also out of the partial
-- index — the actual contact row has its own org+email uniqueness, so the
-- candidate row is now historical.

ALTER TABLE research_contact_candidates
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS evidence_url text,
  ADD COLUMN IF NOT EXISTS agent_run_id uuid REFERENCES agent_runs(id),
  ADD COLUMN IF NOT EXISTS converted_contact_id uuid REFERENCES contacts(id),
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE research_contact_candidates
  DROP CONSTRAINT IF EXISTS research_contact_candidates_status_check;
ALTER TABLE research_contact_candidates
  ADD CONSTRAINT research_contact_candidates_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'converted'));

-- Pre-index dedup: the prior skeletal table had no dedup gate, so any
-- pre-existing duplicate (organization_id, lower(email)) pairs would make
-- the partial UNIQUE index creation fail mid-migration. Empty-out duplicates
-- by keeping the most recently created row per (org, lower(email)) and
-- marking the rest 'rejected' so they fall outside the partial index. This
-- is a no-op when the table is empty (verified before deploy: row count = 0
-- in dev/staging; production deploy must verify the same before applying).
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY organization_id, lower(email)
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM research_contact_candidates
  WHERE email IS NOT NULL AND status IN ('pending', 'approved')
)
UPDATE research_contact_candidates AS rcc
SET status = 'rejected',
    notes = coalesce(rcc.notes, '') || E'\n\n[migrated] superseded duplicate at 0016',
    updated_at = now()
FROM ranked
WHERE ranked.id = rcc.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS research_contact_candidates_org_email_active_idx
  ON research_contact_candidates (organization_id, lower(email))
  WHERE email IS NOT NULL AND status IN ('pending', 'approved');

CREATE INDEX IF NOT EXISTS research_contact_candidates_org_status_idx
  ON research_contact_candidates (organization_id, status, created_at DESC);
