import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  closeDb,
  getDb,
  getJobsByType,
  jobRuns,
  jobs
} from "../src";

const TEST_JOB_TYPE = "job.t021_sla";

after(async () => {
  await clearJobTypeSlaArtifacts();
  await closeDb();
});

test("getJobsByType returns 24h SLA latency, success rate, and dead-letter reasons", async (t) => {
  const db = getDb();
  await clearJobTypeSlaArtifacts();
  t.after(clearJobTypeSlaArtifacts);

  const now = Date.now();
  await insertSucceededRun(new Date(now - 30_000), 1_000);
  await insertSucceededRun(new Date(now - 25_000), 2_000);
  await insertSucceededRun(new Date(now - 20_000), 3_000);
  await insertSucceededRun(new Date(now - 15_000), 4_000);
  await insertTerminalJob("failed", "Transient provider error", new Date(now - 12_000));
  await insertTerminalJob("dead_lettered", "Provider timeout\nstack trace", new Date(now - 10_000));
  await insertTerminalJob("dead_lettered", "Provider timeout\nretry exhausted", new Date(now - 9_000));
  await insertTerminalJob("dead_lettered", "Policy denied", new Date(now - 8_000));
  await insertTerminalJob("dead_lettered", "old reason outside window", new Date(now - 26 * 60 * 60_000));

  const view = await getJobsByType(TEST_JOB_TYPE, 50);

  assert.equal(view.rows.length, 9);
  assert.equal(view.sla.windowHours, 24);
  assert.equal(view.sla.completedRuns, 4);
  assert.equal(view.sla.p50LatencyMs, 2_500);
  assert.ok((view.sla.p95LatencyMs ?? 0) >= 3_800);
  assert.ok((view.sla.p95LatencyMs ?? 0) <= 3_900);
  assert.equal(view.sla.succeeded, 4);
  assert.equal(view.sla.failed, 1);
  assert.equal(view.sla.deadLettered, 3);
  assert.equal(view.sla.totalTerminal, 8);
  assert.equal(view.sla.successRate, 0.5);
  assert.equal(view.sla.deadLetterRate, 0.375);
  assert.deepEqual(view.sla.deadLetteredByReason, [
    { reason: "Provider timeout", count: 2, rate: 0.25 },
    { reason: "Policy denied", count: 1, rate: 0.125 }
  ]);
});

async function insertSucceededRun(startedAt: Date, durationMs: number) {
  const jobId = randomUUID();
  const db = getDb();
  await db.insert(jobs).values({
    id: jobId,
    jobType: TEST_JOB_TYPE,
    status: "succeeded",
    workerPool: "background",
    payloadJson: { test: "t021" },
    correlationId: randomUUID(),
    updatedAt: new Date(startedAt.getTime() + durationMs)
  });
  await db.insert(jobRuns).values({
    id: randomUUID(),
    jobId,
    status: "succeeded",
    workerId: `t021-worker-${randomUUID()}`,
    attempt: 1,
    startedAt,
    finishedAt: new Date(startedAt.getTime() + durationMs)
  });
}

async function insertTerminalJob(status: "failed" | "dead_lettered", lastError: string, updatedAt: Date) {
  const db = getDb();
  await db.insert(jobs).values({
    id: randomUUID(),
    jobType: TEST_JOB_TYPE,
    status,
    workerPool: "background",
    payloadJson: { test: "t021" },
    correlationId: randomUUID(),
    lastError,
    updatedAt
  });
}

async function clearJobTypeSlaArtifacts() {
  const db = getDb();
  const jobIds = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.jobType, TEST_JOB_TYPE));
  const ids = jobIds.map((row) => row.id);
  if (ids.length > 0) {
    await db.delete(jobRuns).where(inArray(jobRuns.jobId, ids));
    await db.delete(jobs).where(inArray(jobs.id, ids));
  }
}
