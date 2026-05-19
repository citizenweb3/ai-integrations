-- Phase 6 RAG: extend rag_documents with metadata needed for structured
-- narrowing + corpus separation (canonical §62.5937-5983 + §63 retrieval).
-- All columns nullable so legacy rows stay valid; new indexing path always
-- populates them.

ALTER TABLE rag_documents
  ADD COLUMN IF NOT EXISTS source_entity_type text;
ALTER TABLE rag_documents
  ADD COLUMN IF NOT EXISTS source_entity_id uuid;
ALTER TABLE rag_documents
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE rag_documents
  ADD COLUMN IF NOT EXISTS corpus_label text;
ALTER TABLE rag_documents
  ADD COLUMN IF NOT EXISTS quality_score integer;
ALTER TABLE rag_documents
  ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE rag_documents
  ADD COLUMN IF NOT EXISTS indexed_version integer NOT NULL DEFAULT 0;
ALTER TABLE rag_documents
  ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE rag_documents
  ADD CONSTRAINT rag_documents_corpus_label_check
  CHECK (corpus_label IS NULL OR corpus_label IN ('positive', 'negative', 'neutral'));

ALTER TABLE rag_documents
  ADD CONSTRAINT rag_documents_quality_score_range
  CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 100));

-- Idempotent re-index: same (source_entity_type, source_entity_id) replaces
-- in place; UNIQUE NULL handling intentional (legacy rows without source
-- keep coexisting).
CREATE UNIQUE INDEX IF NOT EXISTS rag_documents_source_unique_idx
  ON rag_documents (source_entity_type, source_entity_id)
  WHERE source_entity_type IS NOT NULL AND source_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS rag_documents_corpus_label_org_idx
  ON rag_documents (corpus_label, organization_id, eligible_for_retrieval)
  WHERE corpus_label IS NOT NULL;
