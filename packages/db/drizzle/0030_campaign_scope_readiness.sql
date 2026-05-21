ALTER TABLE campaigns
  ADD COLUMN offer_summary text,
  ADD COLUMN desired_cta text,
  ADD COLUMN forbidden_claims text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN sender_identity_id uuid,
  ADD COLUMN policy_profile_id uuid,
  ADD COLUMN max_concurrent_enrichments integer NOT NULL DEFAULT 3,
  ADD COLUMN max_concurrent_drafts integer NOT NULL DEFAULT 5,
  ADD COLUMN max_open_draft_reviews integer NOT NULL DEFAULT 25;
