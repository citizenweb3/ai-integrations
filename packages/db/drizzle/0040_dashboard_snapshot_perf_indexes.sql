-- Dashboard home page (getDashboardSnapshot) was doing a seq scan across
-- event_log (job_id) and jobs (job_type) on every load because neither
-- column was indexed. Combined with the NOT IN -> NOT EXISTS rewrite in
-- repositories.ts, jobs_job_type_idx lets the per-row correlated subquery use
-- the jobs PK instead of hashing the whole table, and event_log_created_at_idx
-- lets the ORDER BY created_at DESC LIMIT 20 stop early via an index scan
-- instead of sorting the full table.
create index if not exists jobs_job_type_idx
  on jobs (job_type);
--> statement-breakpoint
create index if not exists event_log_job_id_idx
  on event_log (job_id);
--> statement-breakpoint
create index if not exists event_log_created_at_idx
  on event_log (created_at);
