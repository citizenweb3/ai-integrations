-- Phase 4 deliverable: quality score scaffolding + autosend readiness annotation
-- (canonical design §15). Adds rule-based score / band / reason tags + readiness
-- label as draft-level columns. All nullable: NULL = never computed yet.
-- Recompute hooks run in-tx after every signal-bearing mutation; existing rows
-- stay NULL until the next mutation triggers a recompute.

alter table drafts add column if not exists quality_score integer;
alter table drafts add column if not exists quality_score_band text;
alter table drafts add column if not exists quality_score_reasons jsonb not null default '[]'::jsonb;
alter table drafts add column if not exists autosend_readiness text;
alter table drafts add column if not exists scores_computed_at timestamptz;

-- Score must be 0..100 when set; band must be one of the canonical labels;
-- readiness must be one of the canonical labels per §15.842-855.
alter table drafts
  add constraint drafts_quality_score_range
  check (quality_score is null or (quality_score between 0 and 100));

alter table drafts
  add constraint drafts_quality_score_band_valid
  check (quality_score_band is null or quality_score_band in ('low','medium','high'));

alter table drafts
  add constraint drafts_autosend_readiness_valid
  check (autosend_readiness is null or autosend_readiness in (
    'not_ready','low_confidence','promising','high_confidence',
    'blocked_by_policy','blocked_by_facts'
  ));

-- Indexed because the dashboard inbox will filter / sort by readiness label
-- and band (high quality first, blocked last) once Phase 5 surfaces it.
create index if not exists drafts_quality_score_band_idx on drafts (quality_score_band);
create index if not exists drafts_autosend_readiness_idx on drafts (autosend_readiness);
