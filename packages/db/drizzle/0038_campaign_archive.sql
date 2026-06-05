-- T-026BU: soft-archive (reversible delete) for a campaign. `archived_at` is the
-- hide/restore marker (null = live/visible; set = archived/hidden); the archive
-- command also flips `status` to 'closed' so every existing inactive guard stops
-- the campaign's activity. `pre_archive_status` captures the status at archive
-- time so unarchive can restore it (fallback 'paused'). Both nullable; existing
-- campaigns default to null = live, so behaviour is unchanged.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS pre_archive_status text;
