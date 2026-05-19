import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test, type TestContext } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  closeDb,
  completeRecoverStaleJobsCronJob,
  ensureRecoverStaleJobsCronScheduled,
  eventLog,
  getDb,
  jobRuns,
  jobs,
  leaseNextJob,
  startJobRun
} from "../src";

after(async () => {
  await closeDb();
});

test("recover stale jobs cron dedupes by availableAt minute bucket", async (t) => {
  const db = getDb();
  await clearRecoverCronJobs();
  t.after(clearRecoverCronJobs);

  const availableAt = nextMinute();
  const sameBucket = new Date(availableAt.getTime() + 30_000);
  const first = await ensureRecoverStaleJobsCronScheduled({ availableAt });
  const second = await ensureRecoverStaleJobsCronScheduled({ availableAt: sameBucket });

  assert.equal(first.enqueued, true);
  assert.ok(first.jobId);
  assert.deepEqual(second, { enqueued: false, jobId: null });

  const [row] = await db
    .select({
      jobType: jobs.jobType,
      status: jobs.status,
      workerPool: jobs.workerPool,
      payloadJson: jobs.payloadJson,
      availableAt: jobs.availableAt
    })
    .from(jobs)
    .where(eq(jobs.id, first.jobId))
    .limit(1);

  assert.ok(row);
  assert.equal(row.jobType, "job.cron_recover_stale_jobs");
  assert.equal(row.status, "queued");
  assert.equal(row.workerPool, "background");
  assert.deepEqual(row.payloadJson, { intervalSeconds: 60 });
  assert.ok(row.availableAt >= availableAt);
  assert.ok(row.availableAt < new Date(availableAt.getTime() + 60_000));
});

test("recover stale jobs cron runs in background and self-reschedules", async (t) => {
  const db = getDb();
  await clearRecoverCronJobs();
  t.after(clearRecoverCronJobs);

  const stale = await insertStaleLeasedJob(t);
  const scheduled = await ensureRecoverStaleJobsCronScheduled({
    availableAt: new Date(),
    intervalSeconds: 60
  });
  assert.equal(scheduled.enqueued, true);
  assert.ok(scheduled.jobId);

  const workerId = `t006-background-${randomUUID()}`;
  const cronJob = await leaseNextJob(workerId, 30, "background");
  assert.equal(cronJob?.job_type, "job.cron_recover_stale_jobs");
  assert.ok(cronJob);

  const run = await startJobRun(cronJob, workerId);
  const beforeComplete = Date.now();
  const result = await completeRecoverStaleJobsCronJob({
    job: cronJob,
    runId: run.id,
    workerId
  });
  const afterComplete = Date.now();

  assert.ok(result.recoveredJobs >= 1);

  const [recovered] = await db
    .select({
      status: jobs.status,
      leasedBy: jobs.leasedBy,
      leasedUntil: jobs.leasedUntil,
      lastError: jobs.lastError
    })
    .from(jobs)
    .where(eq(jobs.id, stale.jobId))
    .limit(1);
  assert.deepEqual(recovered, {
    status: "queued",
    leasedBy: null,
    leasedUntil: null,
    lastError: "Recovered stale lease"
  });

  const [finishedCron] = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, cronJob.id))
    .limit(1);
  assert.deepEqual(finishedCron, { status: "succeeded" });

  const nextRows = await db
    .select({
      id: jobs.id,
      status: jobs.status,
      workerPool: jobs.workerPool,
      availableAt: jobs.availableAt
    })
    .from(jobs)
    .where(and(
      eq(jobs.jobType, "job.cron_recover_stale_jobs"),
      eq(jobs.status, "queued")
    ));
  assert.equal(nextRows.length, 1);
  const [nextCron] = nextRows;
  assert.ok(nextCron);
  assert.notEqual(nextCron.id, cronJob.id);
  assert.equal(nextCron.workerPool, "background");
  assert.ok(nextCron.availableAt >= new Date(beforeComplete + 59_000));
  assert.ok(nextCron.availableAt <= new Date(afterComplete + 61_000));
});

function nextMinute(): Date {
  const date = new Date(Date.now() + 60_000);
  date.setSeconds(0, 0);
  return date;
}

async function insertStaleLeasedJob(t: TestContext): Promise<{ jobId: string }> {
  const db = getDb();
  const jobId = randomUUID();
  const correlationId = randomUUID();

  t.after(async () => {
    await db.delete(eventLog).where(eq(eventLog.jobId, jobId));
    await db.delete(jobs).where(eq(jobs.id, jobId));
  });

  await db.insert(jobs).values({
    id: jobId,
    jobType: "job.generate_cold_draft",
    status: "leased",
    workerPool: "drafting",
    attempts: 1,
    maxAttempts: 3,
    payloadJson: { draftId: randomUUID() },
    leasedBy: `dead-worker-${randomUUID()}`,
    leasedUntil: new Date(Date.now() - 60_000),
    correlationId
  });

  return { jobId };
}

async function clearRecoverCronJobs() {
  const db = getDb();
  const existing = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.jobType, "job.cron_recover_stale_jobs"));
  const ids = existing.map((row) => row.id);
  if (ids.length === 0) {
    return;
  }

  await db.delete(eventLog).where(inArray(eventLog.jobId, ids));
  await db.delete(jobRuns).where(inArray(jobRuns.jobId, ids));
  await db.delete(jobs).where(inArray(jobs.id, ids));
}
