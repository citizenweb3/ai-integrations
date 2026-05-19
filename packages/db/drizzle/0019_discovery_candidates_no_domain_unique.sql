-- Closes a dedupe gap in migration 0018 (canonical §67). The original
-- partial unique on (campaign_id, lower(domain)) collapses re-proposals of
-- the same domain across runs — but proposals with `domain IS NULL` (the
-- agent could not resolve a domain) bypass that index and re-insert
-- freely on every retry, producing duplicate audit rows for the same
-- prospect. Mirror the rubric on `lower(proposed_name)` for the
-- null-domain case so a re-leased job that crashed mid-loop, or a
-- second discovery pass on the same campaign, collapses against the
-- prior null-domain row.
--
-- Active-or-known status set matches 0018's index exactly: terminal
-- rejections (`rejected_by_policy`, `insufficient_fit`) are excluded so
-- a campaign can re-propose a previously-rejected name after policy or
-- agent-confidence changes.

CREATE UNIQUE INDEX IF NOT EXISTS discovery_candidates_active_name_no_domain_idx
  ON discovery_candidates (campaign_id, lower(proposed_name))
  WHERE domain IS NULL AND status IN (
    'proposed','accepted','queued_for_enrichment','enriched','needs_review','duplicate'
  );
