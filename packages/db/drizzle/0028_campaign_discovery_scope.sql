ALTER TABLE campaigns
  ADD COLUMN discovery_source_hints jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN discovery_exclusions text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN allowed_regions text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN max_organizations_to_discover integer NOT NULL DEFAULT 25,
  ADD COLUMN cooldown_between_discovery_seconds integer NOT NULL DEFAULT 3600,
  ADD COLUMN discovery_scope_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_max_organizations_to_discover_positive
    CHECK (max_organizations_to_discover > 0),
  ADD CONSTRAINT campaigns_cooldown_between_discovery_seconds_nonnegative
    CHECK (cooldown_between_discovery_seconds >= 0),
  ADD CONSTRAINT campaigns_discovery_scope_version_positive
    CHECK (discovery_scope_version > 0);
--> statement-breakpoint
CREATE INDEX campaigns_status_discovery_scope_idx
  ON campaigns (status, discovery_scope_version);
