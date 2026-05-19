import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  closeDb,
  completeQueueDepthWatchdogJob,
  ensureQueueDepthWatchdogScheduled,
  eventLog,
  getDb,
  jobRuns,
  jobs,
  runQueueDepthWatchdog,
  startJobRun,
  systemState,
  type LeasedJob
} from "../src";

const CONFIG_KEY = "queue_depth_watchdog";
const BACKLOG_JOB_TYPE = "job.t008_backlog";
const OK_JOB_TYPE = "job.t008_ok";

after(async () => {
  await closeDb();
});

test("queue depth watchdog uses per-jobType threshold and hourly dedup", async (t) => {
  const db = getDb();
  await clearQueueWatchdogArtifacts();
  t.after(clearQueueWatchdogArtifacts);

  await setQueueWatchdogConfig({
    defaultThreshold: 1_000_000_000,
    thresholds: { [BACKLOG_JOB_TYPE]: 2 }
  });
  await insertQueuedJobs(BACKLOG_JOB_TYPE, 3);
  await insertQueuedJobs(OK_JOB_TYPE, 3);

  const now = new Date("2026-05-14T12:34:30.000Z");
  const bucket = "2026-05-14T12:00:00.000Z";
  const notificationKey = `queue_backlog:${BACKLOG_JOB_TYPE}:${bucket}`;
  const concurrencyKey = `telegram_notification:${notificationKey}`;

  const first = await runQueueDepthWatchdog({ now });
  assert.equal(first.detected, 1);
  assert.equal(first.notified, 1);
  assert.equal(first.bucket, bucket);

  const eventRows = await queueBacklogEvents(BACKLOG_JOB_TYPE);
  assert.equal(eventRows.length, 1);
  assert.equal(eventRows[0]?.payloadJson.notificationKey, notificationKey);
  assert.equal(eventRows[0]?.payloadJson.queuedCount, 3);
  assert.equal(eventRows[0]?.payloadJson.threshold, 2);

  const notificationRows = await db
    .select({
      workerPool: jobs.workerPool,
      priority: jobs.priority,
      payloadJson: jobs.payloadJson
    })
    .from(jobs)
    .where(eq(jobs.concurrencyKey, concurrencyKey));
  assert.equal(notificationRows.length, 1);
  assert.equal(notificationRows[0]?.workerPool, "telegram");
  assert.equal(notificationRows[0]?.priority, 95);
  assert.equal(notificationRows[0]?.payloadJson.entityType, "job_queue");
  assert.equal(notificationRows[0]?.payloadJson.entityId, BACKLOG_JOB_TYPE);

  const duplicate = await runQueueDepthWatchdog({ now });
  assert.equal(duplicate.detected, 1);
  assert.equal(duplicate.notified, 0);
  assert.equal((await queueBacklogEvents(BACKLOG_JOB_TYPE)).length, 1);
  assert.equal((await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.concurrencyKey, concurrencyKey))).length, 1);

  const next = await runQueueDepthWatchdog({ now: new Date(now.getTime() + 60 * 60_000) });
  assert.equal(next.detected, 1);
  assert.equal(next.notified, 1);
  assert.equal((await queueBacklogEvents(BACKLOG_JOB_TYPE)).length, 2);
});

test("queue depth watchdog cron runs in background and self-reschedules every 5 minutes", async (t) => {
  const db = getDb();
  await clearQueueWatchdogArtifacts();
  t.after(clearQueueWatchdogArtifacts);

  await setQueueWatchdogConfig({ defaultThreshold: 1_000_000_000, thresholds: {} });
  const scheduled = await ensureQueueDepthWatchdogScheduled({
    availableAt: new Date(),
    intervalSeconds: 300
  });
  assert.equal(scheduled.enqueued, true);
  assert.ok(scheduled.jobId);

  const workerId = `t008-background-${randomUUID()}`;
  const cronJob = await leaseJobById(workerId, 30, scheduled.jobId);
  assert.equal(cronJob?.job_type, "job.cron_queue_depth_watchdog");
  assert.ok(cronJob);

  const run = await startJobRun(cronJob, workerId);
  const beforeComplete = Date.now();
  const result = await completeQueueDepthWatchdogJob({
    job: cronJob,
    runId: run.id,
    workerId
  });
  const afterComplete = Date.now();

  assert.equal(result.detected, 0);
  assert.equal(result.notified, 0);

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
    .where(eq(jobs.jobType, "job.cron_queue_depth_watchdog"));
  const queuedRows = nextRows.filter((row) => row.status === "queued");
  assert.equal(queuedRows.length, 1);
  const [nextCron] = queuedRows;
  assert.ok(nextCron);
  assert.notEqual(nextCron.id, cronJob.id);
  assert.equal(nextCron.workerPool, "background");
  assert.ok(nextCron.availableAt >= new Date(beforeComplete + 299_000));
  assert.ok(nextCron.availableAt <= new Date(afterComplete + 301_000));
});

async function setQueueWatchdogConfig(valueJson: Record<string, unknown>) {
  const db = getDb();
  await db.insert(systemState).values({
    key: CONFIG_KEY,
    valueJson
  }).onConflictDoUpdate({
    target: systemState.key,
    set: { valueJson }
  });
}

async function insertQueuedJobs(jobType: string, count: number) {
  const db = getDb();
  for (let i = 0; i < count; i += 1) {
    await db.insert(jobs).values({
      id: randomUUID(),
      jobType,
      status: "queued",
      workerPool: "background",
      payloadJson: { test: "t008" },
      correlationId: randomUUID()
    });
  }
}

async function queueBacklogEvents(jobType: string) {
  const db = getDb();
  return db
    .select({ payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(sql`${eventLog.eventType} = 'queue_backlog_detected' and ${eventLog.payloadJson}->>'jobType' = ${jobType}`);
}

async function leaseJobById(workerId: string, leaseSeconds: number, jobId: string): Promise<LeasedJob | null> {
  const db = getDb();
  const rows = await db.execute(sql<LeasedJob>`
    update jobs
    set status = 'leased',
        leased_by = ${workerId},
        leased_until = now() + (${leaseSeconds} || ' seconds')::interval,
        attempts = attempts + 1,
        updated_at = now()
    where id = ${jobId}
      and status = 'queued'
      and available_at <= now()
    returning id, job_type, command_id, payload_json, attempts, max_attempts, correlation_id
  `);

  const leasedJobs = rows as unknown as LeasedJob[];
  return leasedJobs[0] ?? null;
}

async function clearQueueWatchdogArtifacts() {
  const db = getDb();
  const watchdogJobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(sql`
      ${jobs.jobType} in (
        'job.cron_queue_depth_watchdog',
        ${BACKLOG_JOB_TYPE},
        ${OK_JOB_TYPE}
      )
      or ${jobs.concurrencyKey} like 'telegram_notification:queue_backlog:%'
    `);
  const jobIds = watchdogJobs.map((row) => row.id);
  if (jobIds.length > 0) {
    await db.delete(eventLog).where(inArray(eventLog.jobId, jobIds));
    await db.delete(jobRuns).where(inArray(jobRuns.jobId, jobIds));
    await db.delete(jobs).where(inArray(jobs.id, jobIds));
  }

  await db.delete(eventLog).where(eq(eventLog.eventType, "queue_backlog_detected"));
  await db.delete(systemState).where(eq(systemState.key, CONFIG_KEY));
}
