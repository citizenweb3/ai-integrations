ALTER TABLE jobs ADD COLUMN worker_pool text NOT NULL DEFAULT 'background';
--> statement-breakpoint
CREATE INDEX jobs_worker_pool_status_idx ON jobs (worker_pool, status, available_at, priority);
--> statement-breakpoint
CREATE TABLE policy_state_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL,
  scope_id uuid,
  scope_key text,
  state_type text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  reason_code text NOT NULL,
  reason_text text,
  effective_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_by_type text NOT NULL DEFAULT 'system',
  created_by_id uuid,
  source_event_id uuid REFERENCES event_log(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_operator_id uuid
);
--> statement-breakpoint
CREATE INDEX policy_state_entries_scope_idx ON policy_state_entries (scope_type, scope_id, scope_key, status);
--> statement-breakpoint
CREATE TABLE work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  priority integer NOT NULL DEFAULT 0,
  source_entity_type text NOT NULL,
  source_entity_id uuid NOT NULL,
  campaign_id uuid REFERENCES campaigns(id),
  organization_id uuid REFERENCES organizations(id),
  thread_id uuid REFERENCES threads(id),
  draft_id uuid REFERENCES drafts(id),
  inbound_message_id uuid REFERENCES inbound_messages(id),
  outbound_message_id uuid REFERENCES outbound_messages(id),
  title text NOT NULL,
  summary text,
  reason_code text NOT NULL,
  action_label text,
  available_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by_operator_id uuid,
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX work_items_dedupe_idx ON work_items (dedupe_key);
--> statement-breakpoint
CREATE INDEX work_items_status_priority_idx ON work_items (status, priority, available_at);
--> statement-breakpoint
CREATE TABLE idempotency_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL,
  scope text NOT NULL,
  operation text NOT NULL,
  status text NOT NULL DEFAULT 'started',
  request_hash text,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX idempotency_registry_key_idx ON idempotency_registry (idempotency_key);
