import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  closeDb,
  completeWorkerHeartbeatWatchdogJob,
  ensureWorkerHeartbeatWatchdogScheduled,
  eventLog,
  getDb,
  jobRuns,
  jobs,
  runWorkerHeartbeatWatchdog,
  startJobRun,
  workerHeartbeats,
  type LeasedJob
} from "../src";

after(async () => {
  await closeDb();
});

test("worker heartbeat watchdog emits one event and one telegram job per worker bucket", async (t) => {
  const db = getDb();
  await clearWorkerWatchdogArtifacts();
  t.after(clearWorkerWatchdogArtifacts);

  const now = new Date("2026-05-14T12:34:30.000Z");
  const staleWorkerId = `t007-stale-${randomUUID()}`;
  const freshWorkerId = `t007-fresh-${randomUUID()}`;
  const stoppedWorkerId = `t007-stopped-${randomUUID()}`;
  const bucket = "2026-05-14T12:34:00.000Z";
  const notificationKey = `worker_unhealthy:${staleWorkerId}:${bucket}`;
  const concurrencyKey = `telegram_notification:${notificationKey}`;

  await insertHeartbeat(staleWorkerId, "running", new Date(now.getTime() - 61_000));
  await insertHeartbeat(freshWorkerId, "running", new Date(now.getTime() - 10_000));
  await insertHeartbeat(stoppedWorkerId, "stopped", new Date(now.getTime() - 120_000));

  const first = await runWorkerHeartbeatWatchdog({ now, staleAfterSeconds: 60 });
  assert.deepEqual(first, {
    checked: 1,
    unhealthy: 1,
    notified: 1,
    bucket
  });

  const eventRows = await workerUnhealthyEvents(staleWorkerId);
  assert.equal(eventRows.length, 1);
  assert.equal(eventRows[0]?.payloadJson.notificationKey, notificationKey);

  const notificationRows = await db
    .select({
      workerPool: jobs.workerPool,
      priority: jobs.priority,
      payloadJson: jobs.payloadJson
    })
    .from(jobs)
    .where(eq(jobs.concurrencyKey, concurrencyKey));
  assert.equal(notificationRows.length, 1);
  assert.equal(notificationRows[0]?.workerPool, "urgent");
  assert.equal(notificationRows[0]?.priority, 95);
  assert.equal(notificationRows[0]?.payloadJson.entityType, "worker_heartbeat");
  assert.equal(notificationRows[0]?.payloadJson.entityId, staleWorkerId);
  assert.match(String(notificationRows[0]?.payloadJson.text), new RegExp(staleWorkerId));

  const duplicate = await runWorkerHeartbeatWatchdog({ now, staleAfterSeconds: 60 });
  assert.deepEqual(duplicate, {
    checked: 1,
    unhealthy: 1,
    notified: 0,
    bucket
  });
  assert.equal((await workerUnhealthyEvents(staleWorkerId)).length, 1);
  assert.equal((await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.concurrencyKey, concurrencyKey))).length, 1);

  const next = await runWorkerHeartbeatWatchdog({
    now: new Date(now.getTime() + 30_000),
    staleAfterSeconds: 60
  });
  assert.equal(next.notified, 1);
  assert.equal((await workerUnhealthyEvents(staleWorkerId)).length, 2);
});

test("worker heartbeat watchdog cron runs in background and self-reschedules", async (t) => {
  const db = getDb();
  await clearWorkerWatchdogArtifacts();
  t.after(clearWorkerWatchdogArtifacts);

  const scheduled = await ensureWorkerHeartbeatWatchdogScheduled({
    availableAt: new Date(),
    intervalSeconds: 60
  });
  assert.equal(scheduled.enqueued, true);
  assert.ok(scheduled.jobId);

  const workerId = `t007-background-${randomUUID()}`;
  const cronJob = await leaseJobById(workerId, 30, scheduled.jobId);
  assert.equal(cronJob?.job_type, "job.cron_worker_heartbeat_watchdog");
  assert.ok(cronJob);

  const run = await startJobRun(cronJob, workerId);
  const beforeComplete = Date.now();
  const testJob: LeasedJob = {
    ...cronJob,
    payload_json: { ...cronJob.payload_json, staleAfterSeconds: 1_000_000_000 }
  };
  const result = await completeWorkerHeartbeatWatchdogJob({
    job: testJob,
    runId: run.id,
    workerId
  });
  const afterComplete = Date.now();

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
    .where(eq(jobs.jobType, "job.cron_worker_heartbeat_watchdog"));
  const queuedRows = nextRows.filter((row) => row.status === "queued");
  assert.equal(queuedRows.length, 1);
  const [nextCron] = queuedRows;
  assert.ok(nextCron);
  assert.notEqual(nextCron.id, cronJob.id);
  assert.equal(nextCron.workerPool, "background");
  assert.ok(nextCron.availableAt >= new Date(beforeComplete + 59_000));
  assert.ok(nextCron.availableAt <= new Date(afterComplete + 61_000));
});

async function insertHeartbeat(workerId: string, status: string, lastSeenAt: Date) {
  const db = getDb();
  await db.insert(workerHeartbeats).values({
    workerId,
    status,
    lastSeenAt,
    metadataJson: { test: "t007" }
  });
}

async function workerUnhealthyEvents(workerId: string) {
  const db = getDb();
  return db
    .select({ payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(sql`${eventLog.eventType} = 'worker_unhealthy' and ${eventLog.payloadJson}->>'workerId' = ${workerId}`);
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

async function clearWorkerWatchdogArtifacts() {
  const db = getDb();
  const watchdogJobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(sql`
      ${jobs.jobType} = 'job.cron_worker_heartbeat_watchdog'
      or ${jobs.concurrencyKey} like 'telegram_notification:worker_unhealthy:%'
    `);
  const jobIds = watchdogJobs.map((row) => row.id);
  if (jobIds.length > 0) {
    await db.delete(eventLog).where(inArray(eventLog.jobId, jobIds));
    await db.delete(jobRuns).where(inArray(jobRuns.jobId, jobIds));
    await db.delete(jobs).where(inArray(jobs.id, jobIds));
  }

  await db.delete(eventLog).where(eq(eventLog.eventType, "worker_unhealthy"));
  await db.delete(workerHeartbeats).where(sql`${workerHeartbeats.workerId} like 't007-%'`);
}
