-- Reply-class unsubscribe suppressions must use the canonical hard
-- suppression reason. `user_unsubscribe` was treated as operator-set and
-- therefore soft-overridable by pre-send guardrails.

UPDATE suppression_entries legacy
SET active = false,
    updated_at = now()
WHERE legacy.reason = 'user_unsubscribe'
  AND legacy.active = true
  AND EXISTS (
    SELECT 1
    FROM suppression_entries canonical
    WHERE canonical.active = true
      AND canonical.reason = 'unsubscribe'
      AND canonical.source = legacy.source
      AND lower(canonical.email) = lower(legacy.email)
      AND canonical.id <> legacy.id
  );

UPDATE suppression_entries
SET reason = 'unsubscribe',
    updated_at = now()
WHERE reason = 'user_unsubscribe';
