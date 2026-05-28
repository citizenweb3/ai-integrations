-- T-026V: per-campaign opt-in for the contact-discovery agent to surface ONE
-- generic outreach inbox (partners@ / bd@ / sales@ / hello@ / contact@) when
-- no specific person was found. Default false → existing campaigns keep the
-- conservative "no generic inboxes" behaviour.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS allow_generic_inbox_fallback boolean NOT NULL DEFAULT false;
