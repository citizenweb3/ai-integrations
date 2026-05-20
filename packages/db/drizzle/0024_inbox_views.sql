CREATE TABLE IF NOT EXISTS inbox_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id text NOT NULL,
  name text NOT NULL,
  filter_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inbox_views_operator_idx
  ON inbox_views (operator_id, name);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS inbox_views_operator_name_uidx
  ON inbox_views (operator_id, name);
