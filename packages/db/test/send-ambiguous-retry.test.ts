import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test, type TestContext } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import {
  closeDb,
  completeSendEmailJob,
  eventLog,
  failJob,
  getDb,
  jobRuns,
  jobs,
  type LeasedJob,
  outboundMessages,
  OutboundStatusTransitionError
} from "../src";

after(async () => {
  await closeDb();
});

test("send_ambiguous retry can resolve to sent exactly once", async (t) => {
  const db = getDb();
  const context = await insertRunningSendJob(t, { status: "send_ambiguous" });

  await completeSendEmailJob({
    job: context.job,
    runId: context.runId,
    workerId: context.workerId,
    outboundMessageId: context.outboundId,
    dispatcher: async () => ({ kind: "sent", providerMessageId: "resend_t002_success" })
  });

  const [outbound] = await db
    .select({
      status: outboundMessages.status,
      providerMessageId: outboundMessages.providerMessageId
    })
    .from(outboundMessages)
    .where(eq(outboundMessages.id, context.outboundId))
    .limit(1);
  assert.deepEqual(outbound, {
    status: "sent",
    providerMessageId: "resend_t002_success"
  });

  const [job] = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, context.job.id))
    .limit(1);
  assert.deepEqual(job, { status: "succeeded" });

  const sentEvents = await db
    .select({ id: eventLog.id })
    .from(eventLog)
    .where(and(
      eq(eventLog.entityType, "outbound_message"),
      eq(eventLog.entityId, context.outboundId),
      eq(eventLog.eventType, "outbound_sent")
    ));
  assert.equal(sentEvents.length, 1);
});

test("unexpected outbound status throws before dispatch and leaves the job failed", async (t) => {
  const db = getDb();
  const context = await insertRunningSendJob(t, { status: "send_failed" });
  let transitionError: unknown;
  let dispatchCalls = 0;

  await assert.rejects(
    async () => completeSendEmailJob({
      job: context.job,
      runId: context.runId,
      workerId: context.workerId,
      outboundMessageId: context.outboundId,
      dispatcher: async () => {
        dispatchCalls += 1;
        return { kind: "sent", providerMessageId: "resend_t002_unexpected" };
      }
    }),
    (error: unknown) => {
      transitionError = error;
      assert.ok(error instanceof OutboundStatusTransitionError);
      assert.equal(error.currentStatus, "send_failed");
      assert.deepEqual(error.fromStatuses, ["send_requested", "send_ambiguous"]);
      assert.equal(error.toStatus, "sent");
      return true;
    }
  );
  assert.equal(dispatchCalls, 0);

  await failJob({
    job: context.job,
    runId: context.runId,
    workerId: context.workerId,
    error: transitionError
  });

  const [run] = await db
    .select({ status: jobRuns.status, errorMessage: jobRuns.errorMessage })
    .from(jobRuns)
    .where(eq(jobRuns.id, context.runId))
    .limit(1);
  assert.equal(run?.status, "failed");
  assert.match(run?.errorMessage ?? "", /status transition send_requested,send_ambiguous -> sent rejected/);

  const [job] = await db
    .select({ status: jobs.status, lastError: jobs.lastError })
    .from(jobs)
    .where(eq(jobs.id, context.job.id))
    .limit(1);
  assert.equal(job?.status, "dead_lettered");
  assert.notEqual(job?.status, "succeeded");
  assert.match(job?.lastError ?? "", /current status is send_failed/);
});

async function insertRunningSendJob(
  t: TestContext,
  input: { status: string; attempts?: number; maxAttempts?: number }
): Promise<{
  outboundId: string;
  runId: string;
  workerId: string;
  job: LeasedJob;
}> {
  const db = getDb();
  const outboundId = randomUUID();
  const jobId = randomUUID();
  const runId = randomUUID();
  const correlationId = randomUUID();
  const workerId = `worker-${randomUUID()}`;
  const attempts = input.attempts ?? 1;
  const maxAttempts = input.maxAttempts ?? 3;
  const recipientEmail = `t002-${randomUUID()}@example.com`;
  const rfc822MessageId = `<${outboundId}@example.com>`;

  t.after(async () => {
    await db.execute(sql`delete from event_log where correlation_id = ${correlationId}`);
    await db.delete(jobRuns).where(eq(jobRuns.id, runId));
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(outboundMessages).where(eq(outboundMessages.id, outboundId));
  });

  await db.insert(outboundMessages).values({
    id: outboundId,
    recipientEmail,
    rfc822MessageId,
    status: input.status,
    idempotencyKey: `t002:${outboundId}`,
    payloadSnapshotJson: {
      recipientEmail,
      fromEmail: "sender@example.com",
      subject: "T-002 retry",
      body: "Hello from T-002",
      rfc822MessageId
    }
  });

  await db.insert(jobs).values({
    id: jobId,
    jobType: "job.send_email",
    status: "running",
    payloadJson: { outboundMessageId: outboundId },
    workerPool: "urgent",
    attempts,
    maxAttempts,
    leasedBy: workerId,
    leasedUntil: new Date(Date.now() + 60_000),
    correlationId
  });

  await db.insert(jobRuns).values({
    id: runId,
    jobId,
    status: "running",
    workerId,
    attempt: attempts
  });

  return {
    outboundId,
    runId,
    workerId,
    job: {
      id: jobId,
      job_type: "job.send_email",
      command_id: null,
      payload_json: { outboundMessageId: outboundId },
      attempts,
      max_attempts: maxAttempts,
      correlation_id: correlationId
    }
  };
}
