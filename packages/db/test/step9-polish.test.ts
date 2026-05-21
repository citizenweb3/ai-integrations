import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { buildMergeThreadsIdempotencyKey } from "@bizdev/shared";
import {
  campaigns,
  closeDb,
  commands,
  completeWebhookProcessingJob,
  contacts,
  drafts,
  draftVersions,
  eventLog,
  getDb,
  getThreadDetail,
  inboundMessages,
  jobs,
  jobRuns,
  mergeThreadsCommand,
  organizations,
  outboundMessages,
  suppressionEntries,
  threadParticipants,
  threads,
  type LeasedJob,
  webhookEvents,
  workItems
} from "../src";

after(async () => {
  await closeDb();
});

test("inbound subject fallback attaches by prior outbound and stores attachment manifest", async (t) => {
  const db = getDb();
  await clearT027Artifacts();
  t.after(clearT027Artifacts);

  const fixture = await insertThreadFixture();
  await insertOutboundMessage({
    fixture,
    subject: "T027 Subject Fallback",
    rfc822MessageId: "<t027-subject-fallback@example.com>"
  });

  await processInboundWebhook({
    providerEventId: `t027-subject-${randomUUID()}`,
    fromEmail: fixture.email,
    subject: "Re: T027 Subject Fallback",
    text: "Can you send the attachment notes?",
    attachments: [
      {
        id: "att_t027_1",
        filename: "brief.pdf",
        content_type: "application/pdf",
        size: 12345
      }
    ]
  });

  const [inbound] = await db
    .select({
      id: inboundMessages.id,
      threadId: inboundMessages.threadId,
      attachmentsJson: inboundMessages.attachmentsJson
    })
    .from(inboundMessages)
    .where(eq(inboundMessages.fromEmail, fixture.email))
    .limit(1);
  assert.ok(inbound);
  assert.equal(inbound.threadId, fixture.threadId);
  assert.deepEqual(inbound.attachmentsJson, [
    {
      filename: "brief.pdf",
      contentType: "application/pdf",
      size: 12345,
      contentId: null,
      providerAttachmentId: "att_t027_1"
    }
  ]);

  const [matchEvent] = await db
    .select({ payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(and(eq(eventLog.eventType, "thread_matched"), eq(eventLog.entityId, inbound.id)))
    .limit(1);
  assert.equal(matchEvent?.payloadJson["method"], "subject_fallback");

  const classifyJobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.jobType, "job.classify_reply"), eq(jobs.targetEntityId, inbound.id)));
  assert.equal(classifyJobs.length, 1);

  const threadDetail = await getThreadDetail(fixture.threadId);
  const inboundMessage = threadDetail?.messages.find((message) => message.kind === "inbound");
  assert.equal(inboundMessage?.attachments[0]?.filename, "brief.pdf");
});

test("inbound header match caps references at 50 before fallback", async (t) => {
  const db = getDb();
  await clearT027Artifacts();
  t.after(clearT027Artifacts);

  const fixture = await insertThreadFixture();
  await insertOutboundMessage({
    fixture,
    subject: "T027 Header Cap",
    rfc822MessageId: "<t027-reference-after-cap@example.com>"
  });

  const references = Array.from({ length: 55 }, (_, index) =>
    index === 54 ? "<t027-reference-after-cap@example.com>" : `<t027-noise-${index}@example.com>`
  ).join(" ");
  await processInboundWebhook({
    providerEventId: `t027-cap-${randomUUID()}`,
    fromEmail: fixture.email,
    subject: "Re: not the stored subject",
    text: "This should not match through reference 55.",
    headers: { References: references }
  });

  const [inbound] = await db
    .select({ id: inboundMessages.id, threadId: inboundMessages.threadId })
    .from(inboundMessages)
    .where(eq(inboundMessages.fromEmail, fixture.email))
    .limit(1);
  assert.ok(inbound);
  assert.equal(inbound.threadId, null);

  const [workItem] = await db
    .select({ status: workItems.status, reasonCode: workItems.reasonCode })
    .from(workItems)
    .where(eq(workItems.inboundMessageId, inbound.id))
    .limit(1);
  assert.deepEqual(workItem, { status: "open", reasonCode: "thread_match_unresolved" });
});

test("hard-suppressed inbound supersedes generated work item", async (t) => {
  const db = getDb();
  await clearT027Artifacts();
  t.after(clearT027Artifacts);

  const email = `t027-hard-${randomUUID()}@example.com`;
  await db.insert(suppressionEntries).values({
    email,
    reason: "unsubscribe",
    source: "test",
    active: true
  });

  await processInboundWebhook({
    providerEventId: `t027-hard-${randomUUID()}`,
    fromEmail: email,
    subject: "No matching thread",
    text: "This mailbox is already hard suppressed."
  });

  const [inbound] = await db
    .select({ id: inboundMessages.id })
    .from(inboundMessages)
    .where(eq(inboundMessages.fromEmail, email))
    .limit(1);
  assert.ok(inbound);

  const [workItem] = await db
    .select({ status: workItems.status, reasonCode: workItems.reasonCode, resolvedAt: workItems.resolvedAt })
    .from(workItems)
    .where(eq(workItems.inboundMessageId, inbound.id))
    .limit(1);
  assert.equal(workItem?.status, "superseded");
  assert.equal(workItem?.reasonCode, "sender_hard_suppressed");
  assert.ok(workItem?.resolvedAt);

  const [event] = await db
    .select({ id: eventLog.id })
    .from(eventLog)
    .where(and(eq(eventLog.eventType, "inbound_from_suppressed_contact"), eq(eventLog.entityId, inbound.id)))
    .limit(1);
  assert.ok(event);
});

test("unmatched inbound burst collapses individual work items into a summary", async (t) => {
  const db = getDb();
  await clearT027Artifacts();
  t.after(clearT027Artifacts);

  const email = `t027-burst-${randomUUID()}@example.com`;
  for (let index = 0; index < 6; index += 1) {
    await processInboundWebhook({
      providerEventId: `t027-burst-${index}-${randomUUID()}`,
      fromEmail: email,
      subject: `Burst ${index}`,
      text: "No thread match."
    });
  }

  const unmatched = await db
    .select({ status: workItems.status, reasonCode: workItems.reasonCode })
    .from(workItems)
    .innerJoin(inboundMessages, eq(workItems.inboundMessageId, inboundMessages.id))
    .where(and(eq(workItems.type, "unmatched_inbound_message"), eq(inboundMessages.fromEmail, email)));
  assert.equal(unmatched.length, 6);
  assert.equal(unmatched.every((row) => row.status === "superseded" && row.reasonCode === "inbound_volume_cap"), true);

  const summaries = await db
    .select({ status: workItems.status, reasonCode: workItems.reasonCode })
    .from(workItems)
    .innerJoin(inboundMessages, eq(workItems.inboundMessageId, inboundMessages.id))
    .where(and(eq(workItems.type, "unmatched_inbound_summary"), eq(inboundMessages.fromEmail, email)));
  assert.deepEqual(summaries, [{ status: "open", reasonCode: "inbound_volume_cap" }]);
});

test("mergeThreadsCommand repoints thread-owned rows and dedupes", async (t) => {
  const db = getDb();
  await clearT027Artifacts();
  t.after(clearT027Artifacts);

  const primary = await insertThreadFixture();
  const secondary = await insertThreadFixture();
  const [secondaryInbound] = await db
    .insert(inboundMessages)
    .values({
      threadId: secondary.threadId,
      fromEmail: secondary.email,
      subject: "Merge me",
      rawText: "This belongs on the primary thread."
    })
    .returning({ id: inboundMessages.id });
  assert.ok(secondaryInbound);
  const secondaryOutbound = await insertOutboundMessage({
    fixture: secondary,
    subject: "Secondary outbound",
    rfc822MessageId: "<t027-secondary-merge@example.com>"
  });
  const [secondaryDraft] = await db
    .insert(drafts)
    .values({
      campaignId: secondary.campaignId,
      contactId: secondary.contactId,
      threadId: secondary.threadId,
      subject: "T027 secondary draft",
      body: "Secondary draft body.",
      status: "draft",
      version: 1,
      claimsValidatedVersion: 1
    })
    .returning({ id: drafts.id });
  assert.ok(secondaryDraft);
  await db.insert(workItems).values({
    type: "thread_match_ambiguous",
    status: "open",
    priority: 80,
    sourceEntityType: "inbound_message",
    sourceEntityId: secondaryInbound.id,
    inboundMessageId: secondaryInbound.id,
    threadId: secondary.threadId,
    title: "Merge work item",
    reasonCode: "thread_match_ambiguous",
    actionLabel: "Resolve",
    dedupeKey: `t027-merge-work-item-${randomUUID()}`
  });

  const reason = "Operator confirmed both replies belong to the same conversation.";
  const idempotencyKey = buildMergeThreadsIdempotencyKey(
    primary.threadId,
    secondary.threadId,
    createHash("sha256").update(reason).digest("hex").slice(0, 16)
  );
  const first = await mergeThreadsCommand({
    payload: {
      primaryThreadId: primary.threadId,
      secondaryThreadId: secondary.threadId,
      reason,
      idempotencyKey
    }
  });
  assert.equal(first.ok, true);
  if (!first.ok) assert.fail(first.failure.message);
  assert.deepEqual(first.moved, {
    inboundMessages: 1,
    outboundMessages: 1,
    drafts: 2,
    workItems: 1,
    participants: 1
  });

  const second = await mergeThreadsCommand({
    payload: {
      primaryThreadId: primary.threadId,
      secondaryThreadId: secondary.threadId,
      reason,
      idempotencyKey
    }
  });
  assert.equal(second.ok, true);
  if (!second.ok) assert.fail(second.failure.message);
  assert.equal(second.deduplicated, true);
  assert.deepEqual(second.moved, first.moved);

  const [secondaryThread] = await db
    .select({ status: threads.status, mergedIntoThreadId: threads.mergedIntoThreadId })
    .from(threads)
    .where(eq(threads.id, secondary.threadId))
    .limit(1);
  assert.deepEqual(secondaryThread, { status: "merged", mergedIntoThreadId: primary.threadId });

  const [inboundAfter] = await db
    .select({ threadId: inboundMessages.threadId })
    .from(inboundMessages)
    .where(eq(inboundMessages.id, secondaryInbound.id))
    .limit(1);
  assert.equal(inboundAfter?.threadId, primary.threadId);

  const [outboundAfter] = await db
    .select({ threadId: outboundMessages.threadId })
    .from(outboundMessages)
    .where(eq(outboundMessages.id, secondaryOutbound.id))
    .limit(1);
  assert.equal(outboundAfter?.threadId, primary.threadId);

  const [draftAfter] = await db
    .select({ threadId: drafts.threadId })
    .from(drafts)
    .where(eq(drafts.id, secondaryDraft.id))
    .limit(1);
  assert.equal(draftAfter?.threadId, primary.threadId);
});

type ThreadFixture = {
  organizationId: string;
  campaignId: string;
  contactId: string;
  threadId: string;
  email: string;
};

async function insertThreadFixture(): Promise<ThreadFixture> {
  const db = getDb();
  const suffix = randomUUID();
  const email = `t027-${suffix}@example.com`;

  const [organization] = await db
    .insert(organizations)
    .values({ name: `t027-org-${suffix}`, domain: `t027-${suffix}.example` })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: `t027-campaign-${suffix}`,
      status: "active",
      objective: "Book demos for Step 9 polish",
      targetSegments: ["T027"]
    })
    .returning({ id: campaigns.id });
  assert.ok(campaign);

  const [contact] = await db
    .insert(contacts)
    .values({ organizationId: organization.id, email, fullName: "T027 Buyer" })
    .returning({ id: contacts.id });
  assert.ok(contact);

  const [thread] = await db
    .insert(threads)
    .values({
      campaignId: campaign.id,
      organizationId: organization.id,
      status: "open",
      providerThreadKey: `t027-thread-${suffix}`
    })
    .returning({ id: threads.id });
  assert.ok(thread);

  await db.insert(threadParticipants).values({
    threadId: thread.id,
    contactId: contact.id,
    email,
    role: "recipient"
  });

  return {
    organizationId: organization.id,
    campaignId: campaign.id,
    contactId: contact.id,
    threadId: thread.id,
    email
  };
}

async function insertOutboundMessage(input: {
  fixture: ThreadFixture;
  subject: string;
  rfc822MessageId: string;
}): Promise<{ id: string }> {
  const db = getDb();
  const [draft] = await db
    .insert(drafts)
    .values({
      campaignId: input.fixture.campaignId,
      contactId: input.fixture.contactId,
      threadId: input.fixture.threadId,
      subject: input.subject,
      body: "Outbound body for Step 9 polish.",
      status: "approved",
      version: 1,
      claimsValidatedVersion: 1
    })
    .returning({ id: drafts.id });
  assert.ok(draft);

  await db.insert(draftVersions).values({
    draftId: draft.id,
    version: 1,
    subject: input.subject,
    body: "Outbound body for Step 9 polish.",
    bodyHash: `t027-${randomUUID()}`,
    claimsValidatedVersion: 1,
    source: "agent_generated"
  });

  const [outbound] = await db
    .insert(outboundMessages)
    .values({
      draftId: draft.id,
      threadId: input.fixture.threadId,
      campaignId: input.fixture.campaignId,
      contactId: input.fixture.contactId,
      recipientEmail: input.fixture.email,
      provider: "resend",
      status: "sent",
      rfc822MessageId: input.rfc822MessageId,
      idempotencyKey: `t027-outbound:${randomUUID()}`,
      payloadSnapshotJson: {
        recipientEmail: input.fixture.email,
        fromEmail: "sender@example.com",
        subject: input.subject,
        body: "Outbound body for Step 9 polish."
      }
    })
    .returning({ id: outboundMessages.id });
  assert.ok(outbound);
  return outbound;
}

async function processInboundWebhook(input: {
  providerEventId: string;
  fromEmail: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
  attachments?: Array<Record<string, unknown>>;
}): Promise<void> {
  const running = await insertRunningWebhookJob({
    providerEventId: input.providerEventId,
    rawBodyJson: {
      id: input.providerEventId,
      type: "email.received",
      data: {
        from: input.fromEmail,
        subject: input.subject,
        text: input.text,
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.attachments ? { attachments: input.attachments } : {})
      }
    }
  });

  await completeWebhookProcessingJob({
    ...running,
    webhookEventId: running.webhookEventId
  });
}

async function insertRunningWebhookJob(input: {
  providerEventId: string;
  rawBodyJson: Record<string, unknown>;
}): Promise<{
  webhookEventId: string;
  job: LeasedJob;
  runId: string;
  workerId: string;
}> {
  const db = getDb();
  const webhookEventId = randomUUID();
  const jobId = randomUUID();
  const runId = randomUUID();
  const correlationId = randomUUID();
  const workerId = `t027-worker-${randomUUID()}`;

  await db.insert(webhookEvents).values({
    id: webhookEventId,
    provider: "resend",
    eventType: "email.received",
    status: "processing",
    dedupeKey: `t027-webhook:${input.providerEventId}`,
    providerEventId: input.providerEventId,
    rawHeadersJson: {},
    rawBodyJson: input.rawBodyJson
  });

  await db.insert(jobs).values({
    id: jobId,
    jobType: "job.process_webhook_event",
    status: "running",
    workerPool: "urgent",
    targetEntityType: "webhook_event",
    targetEntityId: webhookEventId,
    payloadJson: { webhookEventId },
    attempts: 1,
    maxAttempts: 5,
    leasedBy: workerId,
    leasedUntil: new Date(Date.now() + 60_000),
    correlationId
  });

  await db.insert(jobRuns).values({
    id: runId,
    jobId,
    status: "running",
    workerId,
    attempt: 1
  });

  return {
    webhookEventId,
    runId,
    workerId,
    job: {
      id: jobId,
      job_type: "job.process_webhook_event",
      command_id: null,
      payload_json: { webhookEventId },
      attempts: 1,
      max_attempts: 5,
      correlation_id: correlationId
    }
  };
}

async function clearT027Artifacts(): Promise<void> {
  const db = getDb();

  const orgRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql`${organizations.name} like 't027-%'`);
  const orgIds = orgRows.map((row) => row.id);

  const campaignRows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(sql`${campaigns.name} like 't027-%'`);
  const campaignIds = campaignRows.map((row) => row.id);

  const contactRows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`${contacts.email} like 't027-%'`);
  const contactIds = contactRows.map((row) => row.id);

  const threadRows = await db
    .select({ id: threads.id })
    .from(threads)
    .where(or(
      sql`${threads.providerThreadKey} like 't027-%'`,
      ...(orgIds.length > 0 ? [inArray(threads.organizationId, orgIds)] : []),
      ...(campaignIds.length > 0 ? [inArray(threads.campaignId, campaignIds)] : [])
    ));
  const threadIds = threadRows.map((row) => row.id);

  const webhookRows = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(sql`${webhookEvents.providerEventId} like 't027-%'`);
  const webhookIds = webhookRows.map((row) => row.id);

  const inboundRows = await db
    .select({ id: inboundMessages.id })
    .from(inboundMessages)
    .where(or(
      sql`${inboundMessages.fromEmail} like 't027-%'`,
      ...(threadIds.length > 0 ? [inArray(inboundMessages.threadId, threadIds)] : []),
      ...(webhookIds.length > 0 ? [inArray(inboundMessages.webhookEventId, webhookIds)] : [])
    ));
  const inboundIds = inboundRows.map((row) => row.id);

  const draftRows = await db
    .select({ id: drafts.id })
    .from(drafts)
    .where(or(
      sql`${drafts.subject} like 'T027%'`,
      ...(contactIds.length > 0 ? [inArray(drafts.contactId, contactIds)] : []),
      ...(campaignIds.length > 0 ? [inArray(drafts.campaignId, campaignIds)] : []),
      ...(threadIds.length > 0 ? [inArray(drafts.threadId, threadIds)] : [])
    ));
  const draftIds = draftRows.map((row) => row.id);

  const outboundRows = await db
    .select({ id: outboundMessages.id })
    .from(outboundMessages)
    .where(or(
      sql`${outboundMessages.recipientEmail} like 't027-%'`,
      ...(draftIds.length > 0 ? [inArray(outboundMessages.draftId, draftIds)] : []),
      ...(threadIds.length > 0 ? [inArray(outboundMessages.threadId, threadIds)] : [])
    ));
  const outboundIds = outboundRows.map((row) => row.id);

  const jobRows = webhookIds.length > 0 || inboundIds.length > 0 || threadIds.length > 0 || outboundIds.length > 0 || draftIds.length > 0
    ? await db
        .select({ id: jobs.id, commandId: jobs.commandId })
        .from(jobs)
        .where(or(
          ...(webhookIds.length > 0 ? [inArray(jobs.targetEntityId, webhookIds)] : []),
          ...(inboundIds.length > 0 ? [inArray(jobs.targetEntityId, inboundIds)] : []),
          ...(threadIds.length > 0 ? [inArray(jobs.targetEntityId, threadIds)] : []),
          ...(outboundIds.length > 0 ? [inArray(jobs.targetEntityId, outboundIds)] : []),
          ...(draftIds.length > 0 ? [inArray(jobs.targetEntityId, draftIds)] : [])
        ))
    : [];
  const jobIds = jobRows.map((row) => row.id);
  const jobCommandIds = jobRows.map((row) => row.commandId).filter((id): id is string => Boolean(id));

  const commandRows = inboundIds.length > 0 || threadIds.length > 0 || draftIds.length > 0 || jobCommandIds.length > 0
    ? await db
        .select({ id: commands.id })
        .from(commands)
        .where(or(
          ...(inboundIds.length > 0 ? [inArray(commands.targetEntityId, inboundIds)] : []),
          ...(threadIds.length > 0 ? [inArray(commands.targetEntityId, threadIds)] : []),
          ...(draftIds.length > 0 ? [inArray(commands.targetEntityId, draftIds)] : []),
          ...(jobCommandIds.length > 0 ? [inArray(commands.id, jobCommandIds)] : [])
        ))
    : [];
  const commandIds = commandRows.map((row) => row.id);

  const eventEntityIds = [
    ...orgIds,
    ...campaignIds,
    ...contactIds,
    ...threadIds,
    ...inboundIds,
    ...draftIds,
    ...outboundIds,
    ...webhookIds,
    ...jobIds
  ];
  if (eventEntityIds.length > 0 || commandIds.length > 0 || jobIds.length > 0) {
    await db.delete(eventLog).where(or(
      ...(eventEntityIds.length > 0 ? [inArray(eventLog.entityId, eventEntityIds)] : []),
      ...(commandIds.length > 0 ? [inArray(eventLog.commandId, commandIds)] : []),
      ...(jobIds.length > 0 ? [inArray(eventLog.jobId, jobIds)] : [])
    ));
  }

  if (inboundIds.length > 0) await db.delete(workItems).where(inArray(workItems.inboundMessageId, inboundIds));
  if (threadIds.length > 0) await db.delete(workItems).where(inArray(workItems.threadId, threadIds));
  if (webhookIds.length > 0) await db.delete(workItems).where(inArray(workItems.sourceEntityId, webhookIds));
  if (outboundIds.length > 0) await db.delete(outboundMessages).where(inArray(outboundMessages.id, outboundIds));
  if (inboundIds.length > 0) await db.delete(inboundMessages).where(inArray(inboundMessages.id, inboundIds));
  if (draftIds.length > 0) {
    await db.delete(draftVersions).where(inArray(draftVersions.draftId, draftIds));
    await db.delete(drafts).where(inArray(drafts.id, draftIds));
  }
  if (jobIds.length > 0) await db.delete(jobRuns).where(inArray(jobRuns.jobId, jobIds));
  if (jobIds.length > 0) await db.delete(jobs).where(inArray(jobs.id, jobIds));
  if (commandIds.length > 0) await db.delete(commands).where(inArray(commands.id, commandIds));
  if (threadIds.length > 0) {
    await db.update(threads).set({ mergedIntoThreadId: null }).where(inArray(threads.id, threadIds));
    await db.delete(threadParticipants).where(inArray(threadParticipants.threadId, threadIds));
    await db.delete(threads).where(inArray(threads.id, threadIds));
  }
  if (webhookIds.length > 0) await db.delete(webhookEvents).where(inArray(webhookEvents.id, webhookIds));
  if (contactIds.length > 0) await db.delete(contacts).where(inArray(contacts.id, contactIds));
  await db.delete(suppressionEntries).where(sql`${suppressionEntries.email} like 't027-%'`);
  if (campaignIds.length > 0) await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
  if (orgIds.length > 0) await db.delete(organizations).where(inArray(organizations.id, orgIds));
}
