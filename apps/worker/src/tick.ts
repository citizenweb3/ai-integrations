import type { LeasedJob } from "@bizdev/db";
import type { WorkerLogLevel } from "./logger";

export type TickOutcome = "ran_job" | "idle" | "error";

// Collaborators are injected so a single worker loop iteration is unit-testable
// without a database — the test drives the failure paths (a thrown DB error)
// directly.
export interface WorkerTickDeps {
  workerId: string;
  maybeRecordHeartbeat: () => Promise<void>;
  recoverStaleJobs: (workerId: string) => Promise<number>;
  leaseJob: () => Promise<LeasedJob | null>;
  runJob: (job: LeasedJob) => Promise<void>;
  log: (level: WorkerLogLevel, event: string, fields?: Record<string, unknown>) => void;
  serializeError: (error: unknown) => Record<string, unknown>;
}

// One iteration of the worker's main loop. The heartbeat write, stale-lease
// recovery, and job lease all hit the database; before this was extracted they
// ran un-guarded in `main()`, so a transient connection loss (e.g. Postgres
// restarting and dropping the connection mid-query) threw out of the loop, hit
// `main().catch` and `process.exit(1)`. With no restart policy the worker then
// stayed dead. Catching here turns that transient failure into a logged,
// non-fatal "error" outcome: the caller backs off and the next tick re-runs
// once the connection pool has reconnected.
//
// Returns:
//   "ran_job" — a job was leased and dispatched (caller loops immediately),
//   "idle"    — the queue was empty (caller sleeps before retrying),
//   "error"   — the tick failed and was logged (caller sleeps before retrying).
export async function runWorkerTick(deps: WorkerTickDeps): Promise<TickOutcome> {
  try {
    await deps.maybeRecordHeartbeat();

    const recovered = await deps.recoverStaleJobs(deps.workerId);
    if (recovered > 0) {
      deps.log("warn", "stale_jobs_recovered", { count: recovered });
    }

    const job = await deps.leaseJob();
    if (!job) {
      return "idle";
    }

    await deps.runJob(job);
    return "ran_job";
  } catch (error) {
    deps.log("error", "worker_tick_failed", deps.serializeError(error));
    return "error";
  }
}
