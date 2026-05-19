alter table drafts add column claims_validated_version integer;
--> statement-breakpoint
-- Intentionally NOT backfilling claims_validated_version from existing
-- draft_claims rows: the legacy claim sets were written before the canonical
-- §62 revalidation contract existed, and we cannot prove they correspond to
-- the current draft body. Leaving the column NULL for all preexisting drafts
-- forces the pre-send guardrail `claims_stale` to block sends until the
-- operator triggers AI revise or a manual edit re-enqueues revalidation. New
-- drafts written after this migration set the column at insert/revise time.
--> statement-breakpoint
create index drafts_claims_validation_idx
  on drafts (id, version, claims_validated_version);
