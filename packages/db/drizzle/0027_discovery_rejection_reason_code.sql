ALTER TABLE discovery_candidates
  ADD COLUMN IF NOT EXISTS rejection_reason_code text;

UPDATE discovery_candidates
SET rejection_reason_code = CASE
  WHEN rejection_reason ~ '^operator:(out_of_segment|dead_company|competitor|existing_customer|wrong_geo|private_pii|other)(:|$)'
    THEN split_part(rejection_reason, ':', 2)
  WHEN rejection_reason = 'operator' OR rejection_reason LIKE 'operator:%'
    THEN 'other'
  WHEN rejection_reason IN ('out_of_segment', 'dead_company', 'competitor', 'existing_customer', 'wrong_geo', 'private_pii', 'other')
    THEN rejection_reason
  ELSE rejection_reason_code
END
WHERE rejection_reason_code IS NULL
  AND rejection_reason IS NOT NULL;

ALTER TABLE discovery_candidates
  DROP CONSTRAINT IF EXISTS discovery_candidates_rejection_reason_code_check;

ALTER TABLE discovery_candidates
  ADD CONSTRAINT discovery_candidates_rejection_reason_code_check
  CHECK (
    rejection_reason_code IS NULL
    OR rejection_reason_code IN (
      'out_of_segment',
      'dead_company',
      'competitor',
      'existing_customer',
      'wrong_geo',
      'private_pii',
      'other'
    )
  );

CREATE INDEX IF NOT EXISTS discovery_candidates_rejection_reason_code_idx
  ON discovery_candidates (rejection_reason_code)
  WHERE rejection_reason_code IS NOT NULL;
