-- Append-only audit trail of every draft body. Per canonical §60.4509-4520
-- every state transition (operator edit / AI revise / AI generation) writes a
-- new row here; `drafts` keeps pointing at the head version.
create table if not exists draft_versions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references drafts(id),
  version integer not null,
  subject text not null,
  body text not null,
  body_hash text not null,
  claims_validated_version integer,
  source text not null,
  change_notes text,
  agent_run_id uuid references agent_runs(id),
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index if not exists draft_versions_draft_id_version_idx
  on draft_versions (draft_id, version);
--> statement-breakpoint
-- Backfill one row per existing draft at its current version. We don't have
-- the prior bodies (they were overwritten), so the legacy entry represents
-- the head only — labeled `legacy_unknown` so audits can distinguish.
insert into draft_versions (draft_id, version, subject, body, body_hash, claims_validated_version, source, created_at)
select
  d.id,
  d.version,
  d.subject,
  d.body,
  encode(digest(d.subject || E'\n' || d.body, 'sha256'), 'hex'),
  d.claims_validated_version,
  'legacy_unknown',
  d.created_at
from drafts d
on conflict (draft_id, version) do nothing;
