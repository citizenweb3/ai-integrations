import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  closeDb,
  getDb,
  getSystemHealth,
  jobs,
  suppressionEntries,
  webhookEvents,
  workerHeartbeats
} from "../src";
import {
  evaluateDashboardHealthOk,
  GET as healthGet
} from "../../../apps/dashboard/app/health/route";

const TEST_JOB_TYPES = ["job.t009_old_queued", "job.t009_dead"] as const;
const TEST_EMAIL_PREFIX = "t009-health";

after(async () => {
  await closeDb();
});

test("system health includes subsystem detail and active hard suppression count", async (t) => {
  const db = getDb();
  await clearHealthDetailArtifacts();
  t.after(clearHealthDetailArtifacts);

  const now = Date.now();
  const oldQueuedJobId = randomUUID();
  const deadJobId = randomUUID();
  const hardEmail = `${TEST_EMAIL_PREFIX}-${randomUUID()}@example.com`;
  const softEmail = `${TEST_EMAIL_PREFIX}-${randomUUID()}@example.com`;
  const inactiveHardEmail = `${TEST_EMAIL_PREFIX}-${randomUUID()}@example.com`;

  await db.insert(workerHeartbeats).values({
    workerId: `t009-old-${randomUUID()}`,
    status: "running",
    lastSeenAt: new Date(now - 2 * 60 * 60_000),
    metadataJson: { test: "t009" }
  });
  await db.insert(jobs).values([
    {
      id: oldQueuedJobId,
      jobType: "job.t009_old_queued",
      status: "queued",
      workerPool: "background",
      payloadJson: { test: "t009" },
      correlationId: randomUUID(),
      createdAt: new Date(now - 60 * 60_000)
    },
    {
      id: deadJobId,
      jobType: "job.t009_dead",
      status: "dead_lettered",
      workerPool: "background",
      payloadJson: { test: "t009" },
      correlationId: randomUUID()
    }
  ]);
  await db.insert(webhookEvents).values([
    {
      eventType: "email.delivered",
      status: "received",
      dedupeKey: `t009-backlog-${randomUUID()}`
    },
    {
      eventType: "email.delivered",
      status: "processed",
      dedupeKey: `t009-processed-${randomUUID()}`
    }
  ]);
  await db.insert(suppressionEntries).values([
    { email: hardEmail, reason: "unsubscribe", source: "test", active: true },
    { email: softEmail, reason: "manual_block", source: "test", active: true },
    { email: inactiveHardEmail, reason: "complaint", source: "test", active: false }
  ]);

  const health = await getSystemHealth();

  assert.equal(health.database.ok, true);
  assert.equal(typeof health.database.latencyMs, "number");
  assert.ok(health.database.latencyMs >= 0);
  assert.ok((health.jobs.oldestQueuedAge ?? 0) >= 3_500);
  assert.ok((health.workers.oldestHeartbeatAge ?? 0) >= 7_100);
  const [ownHardCount] = await db.execute(sql<{ count: number }>`
    select count(*)::int as count
    from suppression_entries
    where email in (${hardEmail}, ${softEmail}, ${inactiveHardEmail})
      and active = true
      and reason in ('unsubscribe', 'complaint', 'hard_bounce')
  `) as unknown as Array<{ count: number }>;
  // Other test files also touch suppressions in the shared DB, so assert
  // this fixture's contribution without requiring a stable global count.
  assert.equal(ownHardCount?.count, 1);
  assert.ok(health.suppressions.hardCount >= 1);
});

test("dashboard health route returns documented subsystem shape", async (t) => {
  const db = getDb();
  await clearHealthDetailArtifacts();
  t.after(clearHealthDetailArtifacts);

  const previousThreshold = process.env.HEALTH_DEAD_LETTERED_THRESHOLD;
  process.env.HEALTH_DEAD_LETTERED_THRESHOLD = "1000000";
  t.after(() => {
    if (previousThreshold === undefined) {
      delete process.env.HEALTH_DEAD_LETTERED_THRESHOLD;
    } else {
      process.env.HEALTH_DEAD_LETTERED_THRESHOLD = previousThreshold;
    }
  });

  await db.insert(workerHeartbeats).values({
    workerId: `t009-fresh-${randomUUID()}`,
    status: "running",
    lastSeenAt: new Date(),
    metadataJson: { test: "t009" }
  });

  const response = await healthGet();
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body["ok"], true);
  assert.ok(body["checkedAt"]);
  assert.deepEqual(Object.keys(body).sort(), [
    "checkedAt",
    "database",
    "jobs",
    "ok",
    "schema",
    "suppressions",
    "webhooks",
    "workers"
  ]);

  const database = body["database"] as Record<string, unknown>;
  const workers = body["workers"] as Record<string, unknown>;
  const jobsBody = body["jobs"] as Record<string, unknown>;
  const webhooks = body["webhooks"] as Record<string, unknown>;
  const suppressions = body["suppressions"] as Record<string, unknown>;
  assert.equal(database["ok"], true);
  assert.equal(typeof database["latencyMs"], "number");
  assert.equal(typeof workers["total"], "number");
  assert.equal(typeof workers["healthy"], "number");
  assert.ok("oldestHeartbeatAge" in workers);
  assert.equal(typeof jobsBody["queued"], "number");
  assert.equal(typeof jobsBody["deadLettered"], "number");
  assert.ok("oldestQueuedAge" in jobsBody);
  assert.equal(typeof webhooks["backlogCount"], "number");
  assert.equal(typeof suppressions["hardCount"], "number");
});

test("dashboard health ok fails for stale workers or dead-letter threshold breach", async () => {
  const health = await getSystemHealth();

  assert.equal(evaluateDashboardHealthOk({
    ...health,
    workers: { ...health.workers, healthy: 0 }
  }, health.jobs.deadLettered + 1), false);

  assert.equal(evaluateDashboardHealthOk({
    ...health,
    workers: { ...health.workers, healthy: 1 },
    jobs: { ...health.jobs, deadLettered: 2 }
  }, 1), false);
});

async function clearHealthDetailArtifacts() {
  const db = getDb();
  const testJobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(inArray(jobs.jobType, [...TEST_JOB_TYPES]));
  const jobIds = testJobs.map((row) => row.id);
  if (jobIds.length > 0) {
    await db.delete(jobs).where(inArray(jobs.id, jobIds));
  }

  await db.delete(workerHeartbeats).where(sql`${workerHeartbeats.workerId} like 't009-%'`);
  await db.delete(webhookEvents).where(sql`${webhookEvents.dedupeKey} like 't009-%'`);
  await db.delete(suppressionEntries).where(sql`${suppressionEntries.email} like ${`${TEST_EMAIL_PREFIX}-%`}`);
}
