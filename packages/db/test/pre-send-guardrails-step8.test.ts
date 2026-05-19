import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  approveDraftForSendCommand,
  campaigns,
  closeDb,
  commands,
  completeSendEmailJob,
  contacts,
  draftClaims,
  draftFeedback,
  drafts,
  draftVersions,
  evaluatePreSendGuardrails,
  eventLog,
  getDb,
  jobs,
  jobRuns,
  organizations,
  outboundMessages,
  ragChunks,
  ragDocuments,
  ragEmbeddings,
  threads,
  type LeasedJob,
  workItems
} from "../src";

after(async () => {
  await closeDb();
});

test("campaign status guardrails soft-block paused and hard-block closed campaigns", async (t) => {
  await clearT014Artifacts();
  t.after(clearT014Artifacts);

  const paused = await insertStep8Fixture({ campaignStatus: "paused" });
  const pausedGuardrails = await evaluatePreSendGuardrails({
    draftId: paused.draftId,
    recipientEmail: paused.email,
    contactId: paused.contactId
  });
  assert.equal(pausedGuardrails.failures.some((failure) => failure.code === "campaign_paused"), true);
  assert.equal(
    pausedGuardrails.failures.find((failure) => failure.code === "campaign_paused")?.metadata?.["overridable"],
    true
  );

  const closed = await insertStep8Fixture({ campaignStatus: "closed" });
  const closedGuardrails = await evaluatePreSendGuardrails({
    draftId: closed.draftId,
    recipientEmail: closed.email,
    contactId: closed.contactId
  });
  assert.equal(closedGuardrails.failures.some((failure) => failure.code === "campaign_archived"), true);
  assert.equal(
    closedGuardrails.failures.find((failure) => failure.code === "campaign_archived")?.metadata?.["overridable"],
    false
  );
});

test("override audit is linked before outbound action and approve idempotency is draft-version deterministic", async (t) => {
  const db = getDb();
  await clearT014Artifacts();
  t.after(clearT014Artifacts);

  const fixture = await insertStep8Fixture({ campaignStatus: "paused" });
  const first = await approveDraftForSendCommand({
    payload: {
      draftId: fixture.draftId,
      draftVersion: 1,
      manualOverride: {
        acknowledgedCodes: ["campaign_paused"],
        reason: "Operator confirmed the paused campaign exception for this test send."
      }
    },
    fromEmail: "sender@example.com"
  });
  assert.equal(first.ok, true);
  if (!first.ok) assert.fail(`approve failed: ${first.failure.code}`);

  const [overrideEvent] = await db
    .select({
      commandId: eventLog.commandId,
      createdAt: eventLog.createdAt,
      payloadJson: eventLog.payloadJson
    })
    .from(eventLog)
    .where(and(
      eq(eventLog.entityId, fixture.draftId),
      eq(eventLog.eventType, "pre_send_override_applied")
    ))
    .limit(1);
  assert.ok(overrideEvent);
  assert.equal(overrideEvent.commandId, first.command.id);
  assert.deepEqual(overrideEvent.payloadJson["overriddenCodes"], ["campaign_paused"]);
  assert.equal(typeof overrideEvent.payloadJson["qualityScore"], "number");
  assert.equal(typeof overrideEvent.payloadJson["autosendReadiness"], "string");

  const [outbound] = await db
    .select({ id: outboundMessages.id, createdAt: outboundMessages.createdAt })
    .from(outboundMessages)
    .where(eq(outboundMessages.draftId, fixture.draftId))
    .limit(1);
  assert.ok(outbound);
  assert.equal(overrideEvent.createdAt.getTime() <= outbound.createdAt.getTime(), true);

  const second = await approveDraftForSendCommand({
    payload: { draftId: fixture.draftId, draftVersion: 1 },
    fromEmail: "sender@example.com"
  });
  assert.equal(second.ok, true);
  if (!second.ok) assert.fail(`dedupe approve failed: ${second.failure.code}`);
  assert.equal(second.deduplicated, true);
  assert.equal(second.command.id, first.command.id);
  assert.equal(second.outboundMessageId, first.outboundMessageId);
  assert.equal(second.jobId, first.jobId);

  const outboundRows = await db
    .select({ id: outboundMessages.id })
    .from(outboundMessages)
    .where(eq(outboundMessages.draftId, fixture.draftId));
  assert.equal(outboundRows.length, 1);
});

test("approve feedback is deferred until send succeeds", async (t) => {
  const db = getDb();
  await clearT014Artifacts();
  t.after(clearT014Artifacts);

  const fixture = await insertStep8Fixture();
  const approved = await approveDraftForSendCommand({
    payload: { draftId: fixture.draftId, draftVersion: 1 },
    fromEmail: "sender@example.com"
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) assert.fail(`approve failed: ${approved.failure.code}`);

  let [draft] = await db
    .select({ status: drafts.status })
    .from(drafts)
    .where(eq(drafts.id, fixture.draftId))
    .limit(1);
  assert.deepEqual(draft, { status: "approved_pending_send" });

  let feedbackRows = await db
    .select({ id: draftFeedback.id })
    .from(draftFeedback)
    .where(and(eq(draftFeedback.draftId, fixture.draftId), eq(draftFeedback.kind, "approve")));
  assert.equal(feedbackRows.length, 0);

  await runApprovedSendJob({
    jobId: approved.jobId,
    outboundMessageId: approved.outboundMessageId,
    result: { kind: "sent", providerMessageId: "resend_t014_sent" }
  });

  [draft] = await db
    .select({ status: drafts.status })
    .from(drafts)
    .where(eq(drafts.id, fixture.draftId))
    .limit(1);
  assert.deepEqual(draft, { status: "approved" });

  feedbackRows = await db
    .select({ id: draftFeedback.id })
    .from(draftFeedback)
    .where(and(eq(draftFeedback.draftId, fixture.draftId), eq(draftFeedback.kind, "approve")));
  assert.equal(feedbackRows.length, 1);
});

test("permanent send failure leaves no approve feedback and marks draft failed after approval", async (t) => {
  const db = getDb();
  await clearT014Artifacts();
  t.after(clearT014Artifacts);

  const fixture = await insertStep8Fixture();
  const approved = await approveDraftForSendCommand({
    payload: { draftId: fixture.draftId, draftVersion: 1 },
    fromEmail: "sender@example.com"
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) assert.fail(`approve failed: ${approved.failure.code}`);

  await runApprovedSendJob({
    jobId: approved.jobId,
    outboundMessageId: approved.outboundMessageId,
    result: { kind: "failed", reason: "provider rejected recipient", retryable: false }
  });

  const [draft] = await db
    .select({ status: drafts.status })
    .from(drafts)
    .where(eq(drafts.id, fixture.draftId))
    .limit(1);
  assert.deepEqual(draft, { status: "send_failed_post_approve" });

  const feedbackRows = await db
    .select({ id: draftFeedback.id })
    .from(draftFeedback)
    .where(and(eq(draftFeedback.draftId, fixture.draftId), eq(draftFeedback.kind, "approve")));
  assert.equal(feedbackRows.length, 0);

  const [job] = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, approved.jobId))
    .limit(1);
  assert.deepEqual(job, { status: "dead_lettered" });
});

test("thread_active_send only blocks active sends in the same thread", async (t) => {
  const db = getDb();
  await clearT014Artifacts();
  t.after(clearT014Artifacts);

  const fixture = await insertStep8Fixture({ withThread: true });
  assert.ok(fixture.threadId);
  const existingOutboundId = randomUUID();
  await db.insert(outboundMessages).values({
    id: existingOutboundId,
    threadId: fixture.threadId,
    contactId: fixture.contactId,
    recipientEmail: fixture.email,
    provider: "resend",
    status: "send_requested",
    idempotencyKey: `t014-thread:${existingOutboundId}`,
    payloadSnapshotJson: {
      recipientEmail: fixture.email,
      fromEmail: "sender@example.com",
      subject: "T014 thread active",
      body: "T014 active body"
    }
  });

  let guardrails = await evaluatePreSendGuardrails({
    draftId: fixture.draftId,
    recipientEmail: fixture.email,
    threadId: fixture.threadId,
    contactId: fixture.contactId
  });
  assert.equal(guardrails.failures.some((failure) => failure.code === "thread_active_send"), true);

  await db
    .update(outboundMessages)
    .set({ status: "sent" })
    .where(eq(outboundMessages.id, existingOutboundId));
  guardrails = await evaluatePreSendGuardrails({
    draftId: fixture.draftId,
    recipientEmail: fixture.email,
    threadId: fixture.threadId,
    contactId: fixture.contactId
  });
  assert.equal(guardrails.failures.some((failure) => failure.code === "thread_active_send"), false);
});

async function insertStep8Fixture(input: {
  campaignStatus?: "active" | "paused" | "closed";
  withThread?: boolean;
} = {}): Promise<{
  organizationId: string;
  campaignId: string;
  contactId: string;
  threadId: string | null;
  draftId: string;
  email: string;
}> {
  const db = getDb();
  const suffix = randomUUID();
  const email = `t014-${suffix}@example.com`;
  const [organization] = await db
    .insert(organizations)
    .values({ name: `t014-org-${suffix}`, domain: `t014-${suffix}.example` })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: `t014-campaign-${suffix}`,
      status: input.campaignStatus ?? "active",
      objective: "Step 8 guardrail verification.",
      targetSegments: ["T014"]
    })
    .returning({ id: campaigns.id });
  assert.ok(campaign);

  const [contact] = await db
    .insert(contacts)
    .values({ organizationId: organization.id, email, fullName: "T014 Recipient" })
    .returning({ id: contacts.id });
  assert.ok(contact);

  let threadId: string | null = null;
  if (input.withThread) {
    const [thread] = await db
      .insert(threads)
      .values({
        campaignId: campaign.id,
        organizationId: organization.id,
        status: "open",
        providerThreadKey: `t014-thread-${suffix}`
      })
      .returning({ id: threads.id });
    assert.ok(thread);
    threadId = thread.id;
  }

  const subject = `T014 subject ${suffix}`;
  const body = "T014 body with a supported factual claim.";
  const [draft] = await db
    .insert(drafts)
    .values({
      campaignId: campaign.id,
      contactId: contact.id,
      ...(threadId ? { threadId } : {}),
      subject,
      body,
      status: "draft",
      version: 1,
      claimsValidatedVersion: 1
    })
    .returning({ id: drafts.id });
  assert.ok(draft);

  await db.insert(draftVersions).values({
    draftId: draft.id,
    version: 1,
    subject,
    body,
    bodyHash: `t014-${suffix}`,
    claimsValidatedVersion: 1,
    source: "agent_generated"
  });
  await db.insert(draftClaims).values({
    draftId: draft.id,
    claimText: "T014 supported claim for pre-send testing.",
    safety: "supported"
  });

  return {
    organizationId: organization.id,
    campaignId: campaign.id,
    contactId: contact.id,
    threadId,
    draftId: draft.id,
    email
  };
}

async function runApprovedSendJob(input: {
  jobId: string;
  outboundMessageId: string;
  result:
    | { kind: "sent"; providerMessageId: string }
    | { kind: "failed"; reason: string; retryable: boolean };
}): Promise<void> {
  const db = getDb();
  const workerId = `t014-worker-${randomUUID()}`;
  const runId = randomUUID();
  await db
    .update(jobs)
    .set({
      status: "running",
      attempts: 1,
      leasedBy: workerId,
      leasedUntil: new Date(Date.now() + 60_000),
      updatedAt: new Date()
    })
    .where(eq(jobs.id, input.jobId));
  await db.insert(jobRuns).values({
    id: runId,
    jobId: input.jobId,
    status: "running",
    workerId,
    attempt: 1
  });
  const [job] = await db
    .select({
      id: jobs.id,
      jobType: jobs.jobType,
      commandId: jobs.commandId,
      payloadJson: jobs.payloadJson,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      correlationId: jobs.correlationId
    })
    .from(jobs)
    .where(eq(jobs.id, input.jobId))
    .limit(1);
  assert.ok(job);
  const leasedJob: LeasedJob = {
    id: job.id,
    job_type: job.jobType,
    command_id: job.commandId,
    payload_json: job.payloadJson as Record<string, unknown>,
    attempts: job.attempts,
    max_attempts: job.maxAttempts,
    correlation_id: job.correlationId
  };
  await completeSendEmailJob({
    job: leasedJob,
    runId,
    workerId,
    outboundMessageId: input.outboundMessageId,
    dispatcher: async () => input.result
  });
}

async function clearT014Artifacts() {
  const db = getDb();
  const orgRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql`${organizations.name} like 't014-%'`);
  const orgIds = orgRows.map((row) => row.id);

  const campaignRows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(sql`${campaigns.name} like 't014-%'`);
  const campaignIds = campaignRows.map((row) => row.id);

  const contactRows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`${contacts.email} like 't014-%'`);
  const contactIds = contactRows.map((row) => row.id);

  const threadRows = orgIds.length > 0 || campaignIds.length > 0
    ? await db
        .select({ id: threads.id })
        .from(threads)
        .where(or(
          ...(orgIds.length > 0 ? [inArray(threads.organizationId, orgIds)] : []),
          ...(campaignIds.length > 0 ? [inArray(threads.campaignId, campaignIds)] : [])
        ))
    : [];
  const threadIds = threadRows.map((row) => row.id);

  const draftRows = await db
    .select({ id: drafts.id })
    .from(drafts)
    .where(or(
      sql`${drafts.subject} like 'T014%'`,
      ...(contactIds.length > 0 ? [inArray(drafts.contactId, contactIds)] : []),
      ...(campaignIds.length > 0 ? [inArray(drafts.campaignId, campaignIds)] : []),
      ...(threadIds.length > 0 ? [inArray(drafts.threadId, threadIds)] : [])
    ));
  const draftIds = draftRows.map((row) => row.id);

  const draftVersionRows = draftIds.length > 0
    ? await db.select({ id: draftVersions.id }).from(draftVersions).where(inArray(draftVersions.draftId, draftIds))
    : [];
  const draftVersionIds = draftVersionRows.map((row) => row.id);

  const feedbackRows = draftIds.length > 0
    ? await db.select({ id: draftFeedback.id }).from(draftFeedback).where(inArray(draftFeedback.draftId, draftIds))
    : [];
  const feedbackIds = feedbackRows.map((row) => row.id);

  const claimRows = draftIds.length > 0
    ? await db.select({ id: draftClaims.id }).from(draftClaims).where(inArray(draftClaims.draftId, draftIds))
    : [];
  const claimIds = claimRows.map((row) => row.id);

  const outboundRows = draftIds.length > 0 || contactIds.length > 0 || threadIds.length > 0
    ? await db
        .select({ id: outboundMessages.id })
        .from(outboundMessages)
        .where(or(
          ...(draftIds.length > 0 ? [inArray(outboundMessages.draftId, draftIds)] : []),
          ...(contactIds.length > 0 ? [inArray(outboundMessages.contactId, contactIds)] : []),
          ...(threadIds.length > 0 ? [inArray(outboundMessages.threadId, threadIds)] : []),
          sql`${outboundMessages.recipientEmail} like 't014-%'`
        ))
    : [];
  const outboundIds = outboundRows.map((row) => row.id);

  const ragDocumentRows = orgIds.length > 0 || draftIds.length > 0 || draftVersionIds.length > 0 || feedbackIds.length > 0
    ? await db
        .select({ id: ragDocuments.id })
        .from(ragDocuments)
        .where(or(
          ...(orgIds.length > 0 ? [inArray(ragDocuments.organizationId, orgIds)] : []),
          ...(draftIds.length > 0 ? [inArray(ragDocuments.sourceEntityId, draftIds)] : []),
          ...(draftVersionIds.length > 0 ? [inArray(ragDocuments.sourceEntityId, draftVersionIds)] : []),
          ...(feedbackIds.length > 0 ? [inArray(ragDocuments.sourceEntityId, feedbackIds)] : [])
        ))
    : [];
  const ragDocumentIds = ragDocumentRows.map((row) => row.id);

  const jobRows = draftIds.length > 0 || outboundIds.length > 0 || ragDocumentIds.length > 0
    ? await db
        .select({ id: jobs.id, commandId: jobs.commandId })
        .from(jobs)
        .where(or(
          ...(draftIds.length > 0 ? [inArray(jobs.targetEntityId, draftIds)] : []),
          ...(outboundIds.length > 0 ? [inArray(jobs.targetEntityId, outboundIds)] : []),
          ...(ragDocumentIds.length > 0 ? [inArray(jobs.targetEntityId, ragDocumentIds)] : [])
        ))
    : [];
  const jobIds = jobRows.map((row) => row.id);
  const jobCommandIds = jobRows.map((row) => row.commandId).filter((id): id is string => Boolean(id));

  const commandRows = draftIds.length > 0 || claimIds.length > 0 || outboundIds.length > 0 || jobCommandIds.length > 0
    ? await db
        .select({ id: commands.id })
        .from(commands)
        .where(or(
          ...(draftIds.length > 0 ? [inArray(commands.targetEntityId, draftIds)] : []),
          ...(claimIds.length > 0 ? [inArray(commands.targetEntityId, claimIds)] : []),
          ...(outboundIds.length > 0 ? [inArray(commands.targetEntityId, outboundIds)] : []),
          ...(jobCommandIds.length > 0 ? [inArray(commands.id, jobCommandIds)] : [])
        ))
    : [];
  const commandIds = commandRows.map((row) => row.id);

  const eventEntityIds = [
    ...orgIds,
    ...campaignIds,
    ...contactIds,
    ...threadIds,
    ...draftIds,
    ...draftVersionIds,
    ...feedbackIds,
    ...claimIds,
    ...outboundIds,
    ...ragDocumentIds,
    ...jobIds
  ];
  if (eventEntityIds.length > 0 || commandIds.length > 0 || jobIds.length > 0) {
    await db.delete(eventLog).where(or(
      ...(eventEntityIds.length > 0 ? [inArray(eventLog.entityId, eventEntityIds)] : []),
      ...(commandIds.length > 0 ? [inArray(eventLog.commandId, commandIds)] : []),
      ...(jobIds.length > 0 ? [inArray(eventLog.jobId, jobIds)] : [])
    ));
  }

  if (draftIds.length > 0) await db.delete(workItems).where(inArray(workItems.draftId, draftIds));
  if (outboundIds.length > 0) await db.delete(workItems).where(inArray(workItems.outboundMessageId, outboundIds));
  if (jobIds.length > 0) await db.delete(jobRuns).where(inArray(jobRuns.jobId, jobIds));
  if (jobIds.length > 0) await db.delete(jobs).where(inArray(jobs.id, jobIds));
  if (ragDocumentIds.length > 0) {
    const ragChunkRows = await db
      .select({ id: ragChunks.id })
      .from(ragChunks)
      .where(inArray(ragChunks.documentId, ragDocumentIds));
    const ragChunkIds = ragChunkRows.map((row) => row.id);
    if (ragChunkIds.length > 0) await db.delete(ragEmbeddings).where(inArray(ragEmbeddings.chunkId, ragChunkIds));
    await db.delete(ragChunks).where(inArray(ragChunks.documentId, ragDocumentIds));
    await db.delete(ragDocuments).where(inArray(ragDocuments.id, ragDocumentIds));
  }
  if (outboundIds.length > 0) await db.delete(outboundMessages).where(inArray(outboundMessages.id, outboundIds));
  if (feedbackIds.length > 0) await db.delete(draftFeedback).where(inArray(draftFeedback.id, feedbackIds));
  if (claimIds.length > 0) await db.delete(draftClaims).where(inArray(draftClaims.id, claimIds));
  if (draftIds.length > 0) {
    await db.delete(draftVersions).where(inArray(draftVersions.draftId, draftIds));
    await db.delete(drafts).where(inArray(drafts.id, draftIds));
  }
  if (commandIds.length > 0) await db.delete(commands).where(inArray(commands.id, commandIds));
  if (threadIds.length > 0) await db.delete(threads).where(inArray(threads.id, threadIds));
  if (contactIds.length > 0) await db.delete(contacts).where(inArray(contacts.id, contactIds));
  if (campaignIds.length > 0) await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
  if (orgIds.length > 0) await db.delete(organizations).where(inArray(organizations.id, orgIds));
}
