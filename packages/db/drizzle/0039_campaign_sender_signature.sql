-- T-026BV: sender signature for campaigns. Free-text, operator-supplied email
-- sign-off rendered verbatim into the cold-draft + revise prompts. NULL for
-- campaigns created before this feature or without a signature; the prompt
-- builders omit the signature block when null.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS sender_signature text;
