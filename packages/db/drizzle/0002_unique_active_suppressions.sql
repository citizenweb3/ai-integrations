CREATE UNIQUE INDEX suppression_entries_active_unique_idx
  ON suppression_entries (lower(email), reason, source)
  WHERE active = true;
