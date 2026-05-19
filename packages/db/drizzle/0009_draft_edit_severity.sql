-- Phase 4 deliverable: edit severity classification (canonical §15.800-822).
-- Adds two columns to draft_versions: edit_severity (one of none/minor/
-- moderate/major/rewrite, NULL for non-edit rows) and edit_severity_signals
-- (jsonb array of which deterministic sub-signals fired). Set only on rows
-- with source='operator_edited' so the legacy/agent rows stay NULL.

alter table draft_versions
  add column if not exists edit_severity text;

alter table draft_versions
  add column if not exists edit_severity_signals jsonb not null default '[]'::jsonb;

alter table draft_versions
  add constraint draft_versions_edit_severity_valid
  check (
    edit_severity is null
    or edit_severity in ('none','minor','moderate','major','rewrite')
  );

-- The label is also part of the source-vs-severity invariant: only operator
-- edits classify a severity. Other sources MUST keep edit_severity NULL.
alter table draft_versions
  add constraint draft_versions_edit_severity_only_for_edits
  check (
    edit_severity is null
    or source = 'operator_edited'
  );
