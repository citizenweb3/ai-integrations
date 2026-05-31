-- T-026AZ: contacts.email becomes nullable so the operator can approve a
-- candidate before the email is known. Drafts and sends keep their email
-- requirement and filter `WHERE email IS NOT NULL`; emailless contacts
-- hang inert in the approved list until someone fills the address in.
--
-- The unique index on email is replaced by a partial unique index that
-- only constrains non-null rows. Postgres treats NULL as distinct in
-- regular unique indexes too, but the partial form makes the intent
-- explicit and survives any future change to NULL-handling defaults.

ALTER TABLE contacts ALTER COLUMN email DROP NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS contacts_email_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX contacts_email_idx
  ON contacts (email)
  WHERE email IS NOT NULL;
