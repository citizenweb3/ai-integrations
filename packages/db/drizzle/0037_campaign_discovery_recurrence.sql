-- T-026BT: recurring (cron) campaign discovery. Three campaign columns drive a
-- per-campaign self-rescheduling cron: `seconds` (null/0 = one-shot, the
-- existing behaviour; >0 = interval), `active` (scheduler on/off without losing
-- the interval), and `version` (bumped on every recurrence change; the cron
-- payload carries the version it was armed with and only re-arms on a match, so
-- a stop or interval change invalidates any in-flight tick). Existing campaigns
-- default to off, so behaviour is unchanged.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS discovery_recurrence_seconds integer,
  ADD COLUMN IF NOT EXISTS discovery_recurrence_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discovery_recurrence_version integer NOT NULL DEFAULT 0;

-- Hard backstop for single-live-tick per campaign (the campaign-row FOR UPDATE
-- lock is the primary guarantee). Scoped to the cron job type so it cannot
-- reject the `campaign_discovery:<id>` wave successor insert that
-- maybeEnqueueNextDiscoveryWave makes while the current run job is still
-- leased/running (review finding F5).
CREATE UNIQUE INDEX IF NOT EXISTS jobs_cron_campaign_discovery_active_idx
  ON jobs (concurrency_key)
  WHERE status IN ('queued', 'leased', 'running') AND job_type = 'job.cron_campaign_discovery';
