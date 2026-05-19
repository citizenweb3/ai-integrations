-- Phase 4 deliverable: positive/negative/neutral learning artifact routing
-- (canonical §62.5937-5983). Each draft_versions and draft_feedback row is
-- labeled with the learning corpus it belongs to so Phase 6 RAG can pull
-- positive examples and negative anti-patterns separately. Labels are
-- nullable initially (legacy rows stay NULL) but the CHECK enforces the
-- whitelist when set, and the reason-tag jsonb explains *why* the label
-- was chosen.

alter table draft_versions
  add column if not exists corpus_label text;

alter table draft_versions
  add column if not exists corpus_label_reasons jsonb not null default '[]'::jsonb;

alter table draft_versions
  add constraint draft_versions_corpus_label_valid
  check (
    corpus_label is null
    or corpus_label in ('positive','negative','neutral')
  );

create index if not exists draft_versions_corpus_label_idx
  on draft_versions (corpus_label)
  where corpus_label is not null;

alter table draft_feedback
  add column if not exists corpus_label text;

alter table draft_feedback
  add column if not exists corpus_label_reasons jsonb not null default '[]'::jsonb;

alter table draft_feedback
  add constraint draft_feedback_corpus_label_valid
  check (
    corpus_label is null
    or corpus_label in ('positive','negative','neutral')
  );

create index if not exists draft_feedback_corpus_label_idx
  on draft_feedback (corpus_label)
  where corpus_label is not null;
