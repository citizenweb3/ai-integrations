CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TYPE campaign_status AS ENUM ('drafting_scope', 'active', 'paused', 'closed');
--> statement-breakpoint
CREATE TYPE webhook_event_status AS ENUM ('received', 'duplicate_ignored', 'queued_for_processing', 'processing', 'processed', 'processing_failed', 'dead_lettered');
--> statement-breakpoint
CREATE TYPE command_source AS ENUM ('operator', 'system', 'telegram');
--> statement-breakpoint
CREATE TYPE command_status AS ENUM ('accepted', 'rejected', 'queued', 'executing', 'completed', 'failed', 'deduplicated');
--> statement-breakpoint
CREATE TYPE job_status AS ENUM ('queued', 'leased', 'running', 'succeeded', 'failed', 'dead_lettered', 'cancelled');
--> statement-breakpoint
CREATE TYPE job_run_status AS ENUM ('running', 'succeeded', 'failed');
--> statement-breakpoint
CREATE TYPE agent_run_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'needs_repair', 'blocked');
--> statement-breakpoint
CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status campaign_status NOT NULL DEFAULT 'drafting_scope',
  name text NOT NULL,
  objective text NOT NULL,
  target_segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  operator_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domain text,
  country_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX organizations_domain_idx ON organizations (domain);
--> statement-breakpoint
CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  email text NOT NULL,
  full_name text,
  role_title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX contacts_email_idx ON contacts (email);
--> statement-breakpoint
CREATE TABLE outreach_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  organization_id uuid REFERENCES organizations(id),
  contact_id uuid REFERENCES contacts(id),
  status text NOT NULL DEFAULT 'planned',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES campaigns(id),
  organization_id uuid REFERENCES organizations(id),
  status text NOT NULL DEFAULT 'open',
  provider_thread_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE thread_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES threads(id),
  contact_id uuid REFERENCES contacts(id),
  email text NOT NULL,
  role text NOT NULL DEFAULT 'recipient',
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES campaigns(id),
  thread_id uuid REFERENCES threads(id),
  contact_id uuid REFERENCES contacts(id),
  version integer NOT NULL DEFAULT 1,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid REFERENCES drafts(id),
  thread_id uuid REFERENCES threads(id),
  campaign_id uuid REFERENCES campaigns(id),
  contact_id uuid REFERENCES contacts(id),
  recipient_email text NOT NULL,
  provider text NOT NULL DEFAULT 'resend',
  provider_message_id text,
  status text NOT NULL DEFAULT 'send_requested',
  idempotency_key text NOT NULL,
  payload_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX outbound_messages_idempotency_idx ON outbound_messages (idempotency_key);
--> statement-breakpoint
CREATE TABLE inbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_event_id uuid,
  thread_id uuid REFERENCES threads(id),
  from_email text NOT NULL,
  subject text,
  raw_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE suppression_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  reason text NOT NULL,
  source text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX suppression_entries_active_email_idx ON suppression_entries (email, active);
--> statement-breakpoint
CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'resend',
  provider_event_id text,
  event_type text NOT NULL,
  recipient_email text,
  status webhook_event_status NOT NULL DEFAULT 'received',
  dedupe_key text NOT NULL,
  raw_headers_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_body_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX webhook_events_dedupe_idx ON webhook_events (dedupe_key);
--> statement-breakpoint
CREATE INDEX webhook_events_recipient_status_idx ON webhook_events (recipient_email, status);
--> statement-breakpoint
CREATE TABLE commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source command_source NOT NULL,
  command_type text NOT NULL,
  status command_status NOT NULL DEFAULT 'accepted',
  actor_id uuid,
  target_entity_type text,
  target_entity_id uuid,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  correlation_id uuid NOT NULL,
  parent_command_id uuid,
  causation_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX commands_idempotency_idx ON commands (idempotency_key);
--> statement-breakpoint
CREATE INDEX commands_status_idx ON commands (status);
--> statement-breakpoint
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  status job_status NOT NULL DEFAULT 'queued',
  command_id uuid REFERENCES commands(id),
  target_entity_type text,
  target_entity_id uuid,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  available_at timestamptz NOT NULL DEFAULT now(),
  leased_by text,
  leased_until timestamptz,
  concurrency_key text,
  correlation_id uuid NOT NULL,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX jobs_lease_idx ON jobs (status, available_at, priority);
--> statement-breakpoint
CREATE INDEX jobs_concurrency_idx ON jobs (concurrency_key);
--> statement-breakpoint
CREATE TABLE job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id),
  status job_run_status NOT NULL DEFAULT 'running',
  worker_id text NOT NULL,
  attempt integer NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error_message text
);
--> statement-breakpoint
CREATE TABLE event_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  command_id uuid REFERENCES commands(id),
  job_id uuid REFERENCES jobs(id),
  correlation_id uuid NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX event_log_entity_idx ON event_log (entity_type, entity_id);
--> statement-breakpoint
CREATE INDEX event_log_correlation_idx ON event_log (correlation_id);
--> statement-breakpoint
CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime text NOT NULL DEFAULT 'adk',
  stage text NOT NULL,
  status agent_run_status NOT NULL DEFAULT 'queued',
  job_id uuid REFERENCES jobs(id),
  input_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE agent_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id uuid NOT NULL REFERENCES agent_runs(id),
  event_type text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE agent_run_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id uuid NOT NULL REFERENCES agent_runs(id),
  artifact_type text NOT NULL,
  uri text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE research_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  snapshot_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE research_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES research_snapshots(id),
  fact_text text NOT NULL,
  status text NOT NULL DEFAULT 'proposed',
  confidence integer NOT NULL DEFAULT 0,
  safe_for_copy boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE research_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url text,
  source_type text NOT NULL,
  quote_text text,
  captured_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE research_fact_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  research_fact_id uuid NOT NULL REFERENCES research_facts(id),
  research_evidence_id uuid NOT NULL REFERENCES research_evidence(id),
  support_type text NOT NULL
);
--> statement-breakpoint
CREATE TABLE research_contact_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  email text,
  full_name text,
  confidence integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE draft_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES drafts(id),
  claim_text text NOT NULL,
  safety text NOT NULL DEFAULT 'needs_review',
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE draft_claim_fact_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_claim_id uuid NOT NULL REFERENCES draft_claims(id),
  research_fact_id uuid NOT NULL REFERENCES research_facts(id),
  support_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE operator_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_type text NOT NULL,
  campaign_id uuid REFERENCES campaigns(id),
  organization_id uuid REFERENCES organizations(id),
  draft_id uuid REFERENCES drafts(id),
  operator_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE rag_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  eligible_for_retrieval boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE rag_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES rag_documents(id),
  chunk_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE rag_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id uuid NOT NULL REFERENCES rag_chunks(id),
  embedding vector(1536) NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX rag_embeddings_embedding_hnsw_idx ON rag_embeddings USING hnsw (embedding vector_cosine_ops);
