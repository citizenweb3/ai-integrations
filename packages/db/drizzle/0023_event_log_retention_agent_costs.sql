ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS token_usage_json jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS event_log_archive (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  command_id uuid,
  job_id uuid,
  correlation_id uuid NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS event_log_archive_entity_idx
  ON event_log_archive (entity_type, entity_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS event_log_archive_correlation_idx
  ON event_log_archive (correlation_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS event_log_archive_created_at_idx
  ON event_log_archive (created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_cost_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_day timestamptz NOT NULL,
  stage text NOT NULL,
  campaign_id uuid REFERENCES campaigns(id),
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  estimated_usd numeric(12, 6) NOT NULL DEFAULT 0,
  run_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_cost_daily_usage_day_idx
  ON agent_cost_daily (usage_day);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_cost_daily_stage_idx
  ON agent_cost_daily (stage, usage_day);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_cost_daily_campaign_idx
  ON agent_cost_daily (campaign_id, usage_day);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS agent_cost_daily_day_stage_campaign_uidx
  ON agent_cost_daily (
    usage_day,
    stage,
    COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
