-- Prospect discovery slice (Tickets 3.1/3.2, canonical §67) — introduce
-- the `discovery_candidates` table that backs the campaign-level prospect
-- discovery loop. The ADK `campaign_discovery` stage proposes candidate
-- organizations from the campaign brief (objective + target_segments);
-- worker validates, dedupes against existing `organizations`, runs the
-- policy gate, then writes one row per proposal here. Operator reviews
-- in the dashboard (`needs_review`, `proposed`) and accepts/rejects;
-- accepted rows materialize an `organizations` row and trigger the
-- enrichment chain (`job.refresh_research_snapshot`).
--
-- Status lifecycle (canonical §67):
--   proposed                — agent proposal, fresh, no dedupe match
--   accepted                — operator accepted, organization linked
--   duplicate               — strong dedupe match (auto-linked, suppressed)
--   rejected_by_policy      — suppression/cooldown/legal block hit
--   insufficient_fit        — agent self-flagged low confidence
--   needs_review            — medium/weak dedupe ambiguity, operator must decide
--   queued_for_enrichment   — accepted, refresh_research_snapshot enqueued
--   enriched                — research snapshot landed, ready for outreach
--
-- `dedupe_result` records the signal class used by the dedupe service:
--   none | strong | medium | weak (canonical §67 dedupe rubric)
--
-- `source_refs` is jsonb array of {url, title, snippet} entries the
-- discovery agent grounded each proposal on (anti-hallucination).

CREATE TABLE IF NOT EXISTS discovery_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  proposed_name text NOT NULL,
  domain text,
  website_url text,
  country_code text,
  region text,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  fit_rationale text,
  confidence text,
  dedupe_result text NOT NULL DEFAULT 'none',
  -- ON DELETE SET NULL preserves the candidate audit row when an
  -- organization is hard-deleted (the proposal still happened and the
  -- agent_run_id keeps full provenance); without an explicit policy
  -- Postgres defaults to NO ACTION, which would either block the
  -- organization delete or silently leave a stale FK depending on the
  -- delete path.
  matched_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'proposed',
  rejection_reason text,
  agent_run_id uuid REFERENCES agent_runs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE discovery_candidates
  DROP CONSTRAINT IF EXISTS discovery_candidates_confidence_check;
ALTER TABLE discovery_candidates
  ADD CONSTRAINT discovery_candidates_confidence_check
  CHECK (confidence IS NULL OR confidence IN ('low','medium','high'));

ALTER TABLE discovery_candidates
  DROP CONSTRAINT IF EXISTS discovery_candidates_dedupe_result_check;
ALTER TABLE discovery_candidates
  ADD CONSTRAINT discovery_candidates_dedupe_result_check
  CHECK (dedupe_result IN ('none','strong','medium','weak'));

ALTER TABLE discovery_candidates
  DROP CONSTRAINT IF EXISTS discovery_candidates_status_check;
ALTER TABLE discovery_candidates
  ADD CONSTRAINT discovery_candidates_status_check
  CHECK (status IN (
    'proposed','accepted','duplicate','rejected_by_policy',
    'insufficient_fit','needs_review','queued_for_enrichment','enriched'
  ));

-- Operator queue lookup — "show me everything to review on this campaign,
-- newest first". Composite covers the typical filter (campaign + status).
CREATE INDEX IF NOT EXISTS discovery_candidates_campaign_status_idx
  ON discovery_candidates (campaign_id, status, created_at DESC);

-- Dedupe enforcement at the table level — one *active-or-known* candidate
-- per (campaign, lower(domain)). `duplicate` is included because a strong
-- dedupe match already established this domain is known to the campaign;
-- re-proposing it would create a redundant audit row that the dedupe
-- service would just re-flag on the next pass. Terminal-rejected statuses
-- (`rejected_by_policy`, `insufficient_fit`) are excluded so a campaign
-- can re-propose a previously-rejected domain after policy changes.
-- Domains are stored case-insensitively (lower() in index) because the
-- canonicalizer in the dedupe service already lowercases.
CREATE UNIQUE INDEX IF NOT EXISTS discovery_candidates_active_domain_idx
  ON discovery_candidates (campaign_id, lower(domain))
  WHERE domain IS NOT NULL AND status IN (
    'proposed','accepted','queued_for_enrichment','enriched','needs_review','duplicate'
  );
