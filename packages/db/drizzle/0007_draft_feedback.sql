-- Append-only learning corpus per canonical §62. Every operator action that
-- expresses a judgment about a draft (manual edit, AI revise request,
-- approval, discard, standalone note) writes one row here, attributed to the
-- specific draft version the operator was looking at when they acted. Down-
-- stream learning routes positive (`approve`, no edits) vs negative
-- (`manual_edit` after `agent_revised`, `ai_revise` with negative tags)
-- signals from this table.
create table if not exists draft_feedback (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references drafts(id),
  draft_version integer not null,
  kind text not null,
  tags jsonb not null default '[]'::jsonb,
  note text,
  actor_id text,
  source_command_id uuid references commands(id),
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create index if not exists draft_feedback_draft_id_idx
  on draft_feedback (draft_id, created_at desc);
--> statement-breakpoint
create index if not exists draft_feedback_kind_idx
  on draft_feedback (kind, created_at desc);
