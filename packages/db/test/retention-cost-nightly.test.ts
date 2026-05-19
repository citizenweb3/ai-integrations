import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  agentCostDaily,
  agentRuns,
  closeDb,
  ensureBackgroundCronsScheduled,
  eventLog,
  eventLogArchive,
  getDb,
  jobs,
  jobRuns,
  rollupAgentCosts,
  rotateEventLog
} from "../src";

const COST_STAGE = "draft_email";
const COST_USAGE_DAY = new Date("2026-05-01T00:00:00.000Z");
const BACKGROUND_CRON_TYPES = [
  "job.resurface_policy_states",
  "job.cron_recover_stale_jobs",
  "job.cron_worker_heartbeat_watchdog",
  "job.cron_queue_depth_watchdog",
  "job.cron_rotate_event_log",
  "job.cron_rollup_agent_costs"
] as const;

after(async () => {
  await closeDb();
});

test("rotateEventLog archives and deletes event_log rows older than retention", async (t) => {
  const db = getDb();
  const correlationId = randomUUID();
  t.after(async () => {
    await db.delete(eventLogArchive).where(eq(eventLogArchive.correlationId, correlationId));
    await db.delete(eventLog).where(eq(eventLog.correlationId, correlationId));
  });

  await db.insert(eventLog).values([
    {
      eventType: "command_accepted",
      entityType: "system_state",
      correlationId,
      payloadJson: { marker: "t018-old-a" },
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    },
    {
      eventType: "job_succeeded",
      entityType: "system_state",
      correlationId,
      payloadJson: { marker: "t018-old-b" },
      createdAt: new Date("2026-01-15T00:00:00.000Z")
    },
    {
      eventType: "worker_unhealthy",
      entityType: "system_state",
      correlationId,
      payloadJson: { marker: "t018-recent" },
      createdAt: new Date("2026-04-15T00:00:00.000Z")
    }
  ]);

  const result = await rotateEventLog({
    now: new Date("2026-05-01T00:00:00.000Z"),
    retentionDays: 90,
    correlationId
  });
  assert.ok(result.archivedRows >= 2);

  const archived = await db
    .select({
      eventType: eventLogArchive.eventType,
      payloadJson: eventLogArchive.payloadJson
    })
    .from(eventLogArchive)
    .where(eq(eventLogArchive.correlationId, correlationId));
  assert.deepEqual(
    archived.map((row) => row.payloadJson.marker).sort(),
    ["t018-old-a", "t018-old-b"]
  );

  const remaining = await db
    .select({ eventType: eventLog.eventType, payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(eq(eventLog.correlationId, correlationId));
  assert.equal(remaining.some((row) => row.payloadJson.marker === "t018-old-a"), false);
  assert.equal(remaining.some((row) => row.payloadJson.marker === "t018-old-b"), false);
  assert.equal(remaining.some((row) => row.payloadJson.marker === "t018-recent"), true);
  assert.equal(remaining.some((row) => row.eventType === "event_log_rotated"), true);
});

test("rollupAgentCosts writes daily totals and emits a cost-spike telegram alert", async (t) => {
  const db = getDb();
  const correlationId = randomUUID();
  await clearCostArtifacts(correlationId);
  t.after(async () => clearCostArtifacts(correlationId));

  for (let i = 1; i <= 7; i += 1) {
    await db.insert(agentCostDaily).values({
      usageDay: addDaysUtc(COST_USAGE_DAY, -i),
      stage: COST_STAGE,
      estimatedUsd: "1.000000",
      runCount: 1
    });
  }

  await db.insert(agentRuns).values({
    id: randomUUID(),
    stage: COST_STAGE,
    status: "succeeded",
    inputSnapshotJson: { marker: "t018-cost" },
    tokenUsageJson: {
      modelId: "gemini-test",
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      costUsd: 4
    },
    createdAt: new Date("2026-05-01T03:30:00.000Z"),
    updatedAt: new Date("2026-05-01T03:30:00.000Z")
  });

  const result = await rollupAgentCosts({
    usageDay: COST_USAGE_DAY,
    lookbackDays: 7,
    spikeMultiplier: 3,
    correlationId
  });
  assert.equal(result.rolledUpRows, 1);
  assert.equal(result.spikeAlerts, 1);
  assert.equal(result.totalEstimatedUsd, 4);

  const [daily] = await db
    .select({
      promptTokens: agentCostDaily.promptTokens,
      completionTokens: agentCostDaily.completionTokens,
      totalTokens: agentCostDaily.totalTokens,
      estimatedUsd: agentCostDaily.estimatedUsd,
      runCount: agentCostDaily.runCount
    })
    .from(agentCostDaily)
    .where(and(
      eq(agentCostDaily.usageDay, COST_USAGE_DAY),
      eq(agentCostDaily.stage, COST_STAGE),
      isNull(agentCostDaily.campaignId)
    ))
    .limit(1);
  assert.deepEqual(daily, {
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
    estimatedUsd: "4.000000",
    runCount: 1
  });

  const events = await db
    .select({ eventType: eventLog.eventType })
    .from(eventLog)
    .where(eq(eventLog.correlationId, correlationId));
  assert.equal(events.some((row) => row.eventType === "agent_costs_rolled_up"), true);
  assert.equal(events.some((row) => row.eventType === "agent_cost_spike"), true);

  const [notification] = await db
    .select({
      workerPool: jobs.workerPool,
      priority: jobs.priority,
      payloadJson: jobs.payloadJson
    })
    .from(jobs)
    .where(eq(jobs.concurrencyKey, "telegram_notification:agent_cost_spike:draft_email:none:2026-05-01"))
    .limit(1);
  assert.equal(notification?.workerPool, "telegram");
  assert.equal(notification?.priority, 90);
  assert.equal(notification?.payloadJson.notificationKey, "agent_cost_spike:draft_email:none:2026-05-01");
});

test("ensureBackgroundCronsScheduled registers the nightly retention and cost jobs", async (t) => {
  const db = getDb();
  await clearBackgroundCronJobs();
  t.after(clearBackgroundCronJobs);

  const scheduled = await ensureBackgroundCronsScheduled({
    availableAt: new Date("2026-05-01T00:05:00.000Z")
  });
  assert.equal(scheduled.rotateEventLog.enqueued, true);
  assert.equal(scheduled.rollupAgentCosts.enqueued, true);

  const rows = await db
    .select({
      jobType: jobs.jobType,
      workerPool: jobs.workerPool,
      payloadJson: jobs.payloadJson
    })
    .from(jobs)
    .where(inArray(jobs.jobType, ["job.cron_rotate_event_log", "job.cron_rollup_agent_costs"]));
  assert.equal(rows.length, 2);
  assert.equal(rows.every((row) => row.workerPool === "background"), true);
  assert.equal(rows.some((row) => row.jobType === "job.cron_rotate_event_log" && row.payloadJson.retentionDays === 90), true);
  assert.equal(rows.some((row) => row.jobType === "job.cron_rollup_agent_costs" && row.payloadJson.spikeMultiplier === 3), true);
});

async function clearCostArtifacts(correlationId: string) {
  const db = getDb();
  const notificationJobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.concurrencyKey, "telegram_notification:agent_cost_spike:draft_email:none:2026-05-01"));
  const notificationJobIds = notificationJobs.map((row) => row.id);
  if (notificationJobIds.length > 0) {
    await db.delete(eventLog).where(inArray(eventLog.jobId, notificationJobIds));
    await db.delete(jobRuns).where(inArray(jobRuns.jobId, notificationJobIds));
    await db.delete(jobs).where(inArray(jobs.id, notificationJobIds));
  }

  await db.delete(eventLog).where(eq(eventLog.correlationId, correlationId));
  await db.delete(agentCostDaily).where(and(
    eq(agentCostDaily.stage, COST_STAGE),
    gte(agentCostDaily.usageDay, addDaysUtc(COST_USAGE_DAY, -7)),
    lte(agentCostDaily.usageDay, COST_USAGE_DAY)
  ));
  await db.delete(agentRuns).where(sql`${agentRuns.inputSnapshotJson}->>'marker' = 't018-cost'`);
}

async function clearBackgroundCronJobs() {
  const db = getDb();
  const cronJobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(inArray(jobs.jobType, [...BACKGROUND_CRON_TYPES]));
  const cronJobIds = cronJobs.map((row) => row.id);
  if (cronJobIds.length === 0) {
    return;
  }

  await db.delete(eventLog).where(inArray(eventLog.jobId, cronJobIds));
  await db.delete(jobRuns).where(inArray(jobRuns.jobId, cronJobIds));
  await db.delete(jobs).where(inArray(jobs.id, cronJobIds));
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000);
}
