-- T-026BO: structured email drafting brief collected by the campaign chat
-- assistant (angle / tone / talking points / facts about us). NULL for campaigns
-- created before this feature or via the scope-only form; the cold-draft context
-- builder omits the brief lines when null, so existing campaigns are unaffected.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS draft_brief_json jsonb;
