-- Phase 4 deliverable: warm/in-thread draft variant scaffolding (canonical
-- §11.657-662, §35, §37). Adds `drafts.kind` (`cold` | `warm`) so future
-- guardrails (canonical §12.710-713: warm sends use different policy buckets
-- than cold), analytics, and Inbox filtering can distinguish the two flows
-- without inspecting `draftVersions.source` or guessing from threadId.

alter table drafts
  add column if not exists kind text not null default 'cold';

alter table drafts
  add constraint drafts_kind_valid
  check (kind in ('cold','warm'));

create index if not exists drafts_kind_status_idx
  on drafts (kind, status);
