ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS primary_contact_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organizations_primary_contact_id_fkey'
      AND conrelid = 'organizations'::regclass
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_primary_contact_id_fkey
      FOREIGN KEY (primary_contact_id)
      REFERENCES contacts(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS organizations_primary_contact_id_idx
  ON organizations (primary_contact_id);
