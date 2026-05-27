ALTER TABLE research_contact_candidates
  ADD COLUMN IF NOT EXISTS rejection_reason_code text;

-- No structured backfill: historical contact rejects only ever stored free
-- text in `notes` (suffixed `[rejected] ...`), never a coded prefix, so there
-- is nothing to parse. Existing rows keep NULL rejection_reason_code, which the
-- CHECK below permits.

ALTER TABLE research_contact_candidates
  DROP CONSTRAINT IF EXISTS research_contact_candidates_rejection_reason_code_check;

ALTER TABLE research_contact_candidates
  ADD CONSTRAINT research_contact_candidates_rejection_reason_code_check
  CHECK (
    rejection_reason_code IS NULL
    OR rejection_reason_code IN (
      'wrong_person',
      'left_company',
      'private_pii',
      'duplicate_of',
      'low_confidence',
      'other'
    )
  );

CREATE INDEX IF NOT EXISTS research_contact_candidates_rejection_reason_code_idx
  ON research_contact_candidates (rejection_reason_code)
  WHERE rejection_reason_code IS NOT NULL;
