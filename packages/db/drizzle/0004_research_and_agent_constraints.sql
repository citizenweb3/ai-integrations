delete from research_snapshots where organization_id is null;
--> statement-breakpoint
alter table research_snapshots alter column organization_id set not null;
--> statement-breakpoint
create unique index research_snapshots_org_version_uidx
  on research_snapshots (organization_id, snapshot_version);
--> statement-breakpoint
create unique index agent_runs_job_id_uidx
  on agent_runs (job_id)
  where job_id is not null;
