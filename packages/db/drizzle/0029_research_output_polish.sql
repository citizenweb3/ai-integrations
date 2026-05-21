ALTER TABLE research_snapshots
  ADD COLUMN questions_json jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE research_contact_candidates
  ADD COLUMN source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
CREATE INDEX research_contact_candidates_org_name_active_idx
  ON research_contact_candidates (organization_id, lower(full_name))
  WHERE email IS NULL AND status IN ('pending', 'approved');
--> statement-breakpoint
CREATE INDEX research_contact_candidates_last_seen_idx
  ON research_contact_candidates (last_seen_at);
--> statement-breakpoint
ALTER TABLE rag_documents
  DROP CONSTRAINT IF EXISTS rag_documents_corpus_label_check;
--> statement-breakpoint
ALTER TABLE rag_documents
  ADD CONSTRAINT rag_documents_corpus_label_check
  CHECK (corpus_label IN ('positive', 'negative', 'neutral', 'research_fact'));
