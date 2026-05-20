import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  closeDb,
  getDb,
  jobs,
  outboundMessages,
  webhookEvents,
  workerHeartbeats
} from "../src";
import { GET as metricsGet } from "../../../apps/dashboard/app/metrics/route";

after(async () => {
  await closeDb();
});

test("/metrics returns Prometheus exposition with required BizDev counters", async (t) => {
  const db = getDb();
  const suffix = randomUUID();
  const queuedJobType = `job.t025_queued_${suffix}`;
  const deadLetteredJobType = `job.t025_dead_${suffix}`;
  const workerId = `t025-worker-${suffix}`;
  const webhookDedupeKey = `t025-webhook:${suffix}`;
  const sentIdempotencyKey = `t025-sent:${suffix}`;
  const failedIdempotencyKey = `t025-failed:${suffix}`;

  t.after(async () => {
    await db.delete(jobs).where(inArray(jobs.jobType, [queuedJobType, deadLetteredJobType]));
    await db.delete(workerHeartbeats).where(eq(workerHeartbeats.workerId, workerId));
    await db.delete(webhookEvents).where(eq(webhookEvents.dedupeKey, webhookDedupeKey));
    await db.delete(outboundMessages).where(inArray(outboundMessages.idempotencyKey, [
      sentIdempotencyKey,
      failedIdempotencyKey
    ]));
  });

  await db.insert(jobs).values([
    { jobType: queuedJobType, status: "queued", correlationId: randomUUID() },
    { jobType: queuedJobType, status: "queued", correlationId: randomUUID() },
    { jobType: deadLetteredJobType, status: "dead_lettered", correlationId: randomUUID() }
  ]);
  await db.insert(workerHeartbeats).values({
    workerId,
    status: "running",
    lastSeenAt: new Date(),
    metadataJson: { marker: "t025" }
  });
  await db.insert(webhookEvents).values({
    provider: "resend",
    eventType: "email.delivered",
    status: "received",
    dedupeKey: webhookDedupeKey
  });
  await db.insert(outboundMessages).values([
    {
      recipientEmail: `t025-sent-${suffix}@example.com`,
      status: "sent",
      idempotencyKey: sentIdempotencyKey
    },
    {
      recipientEmail: `t025-failed-${suffix}@example.com`,
      status: "send_failed",
      idempotencyKey: failedIdempotencyKey
    }
  ]);

  const response = await metricsGet();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/plain/);

  const body = await response.text();
  assert.match(body, /^# HELP bizdev_jobs_queued /m);
  assert.match(body, /^# TYPE bizdev_jobs_queued gauge$/m);
  assert.match(body, new RegExp(`^bizdev_jobs_queued\\{job_type="${escapeRegExp(queuedJobType)}"\\} 2$`, "m"));
  assert.match(body, new RegExp(`^bizdev_jobs_dead_lettered\\{job_type="${escapeRegExp(deadLetteredJobType)}"\\} 1$`, "m"));

  for (const metricName of [
    "bizdev_workers_healthy",
    "bizdev_webhooks_backlog",
    "bizdev_outbound_sent_total",
    "bizdev_outbound_failed_total"
  ]) {
    const value = readUnlabeledMetric(body, metricName);
    assert.ok(Number.isFinite(value), `${metricName} should be present`);
  }

  assert.ok(readUnlabeledMetric(body, "bizdev_workers_healthy") >= 1);
  assert.ok(readUnlabeledMetric(body, "bizdev_webhooks_backlog") >= 1);
  assert.ok(readUnlabeledMetric(body, "bizdev_outbound_sent_total") >= 1);
  assert.ok(readUnlabeledMetric(body, "bizdev_outbound_failed_total") >= 1);
});

function readUnlabeledMetric(body: string, metricName: string): number {
  const match = body.match(new RegExp(`^${metricName} ([0-9.]+)$`, "m"));
  return match ? Number(match[1]) : Number.NaN;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
