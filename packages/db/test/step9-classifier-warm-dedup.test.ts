import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { buildGenerateWarmDraftIdempotencyKey } from "@bizdev/shared";
import {
  agentRunArtifacts,
  agentRunEvents,
  agentRuns,
  attachInboundToThreadCommand,
  campaigns,
  closeDb,
  commands,
  completeClassifyReplyJob,
  contacts,
  drafts,
  draftVersions,
  eventLog,
  generateWarmDraftCommand,
  getDb,
  inboundMessages,
  jobs,
  jobRuns,
  organizations,
  outboundMessages,
  researchFacts,
  researchSnapshots,
  threadParticipants,
  threads,
  type AgentStageDispatcher,
  type LeasedJob,
  workItems
} from "../src";

after(async () => {
  await closeDb();
});

test("classifier prompt strips quoted history/signature and includes campaign plus snapshot context", async (t) => {
  const db = getDb();
  await clearT015Artifacts();
  t.after(clearT015Artifacts);

  const fixture = await insertStep9Fixture({ withOutbound: true, withSnapshot: true });
  const [inbound] = await db
    .insert(inboundMessages)
    .values({
      threadId: fixture.threadId,
      fromEmail: fixture.email,
      subject: "Re: T015 prompt",
      rawText:
        "Yes, send the details.\n\n-- \nMobile Signature\nOn Tuesday, Sender wrote:\n> Old quoted outbound claim\n> Please ignore this quote."
    })
    .returning({ id: inboundMessages.id });
  assert.ok(inbound);
  const running = await insertRunningClassifyJob(inbound.id);

  let capturedPrompt = "";
  const dispatcher: AgentStageDispatcher = async function* ({ prompt }) {
    capturedPrompt = prompt;
    yield {
      eventType: "final_response",
      payloadJson: {
        text: JSON.stringify({
          class: "positive_interest",
          confidence: "high",
          reasoning: "The reply asks for details.",
          signals: ["send the details"]
        })
      }
    };
  };

  await completeClassifyReplyJob({
    ...running,
    inboundMessageId: inbound.id,
    dispatcher
  });

  assert.match(capturedPrompt, /Yes, send the details\./);
  assert.doesNotMatch(capturedPrompt, /Mobile Signature/);
  assert.doesNotMatch(capturedPrompt, /Old quoted outbound claim/);
  assert.match(capturedPrompt, /Book demos for secure onboarding teams/);
  assert.match(capturedPrompt, /T015 SnapshotCo uses SOC2 automation/);
});

test("attachInboundToThreadCommand enqueues classify_reply after operator attachment", async (t) => {
  const db = getDb();
  await clearT015Artifacts();
  t.after(clearT015Artifacts);

  const fixture = await insertStep9Fixture();
  const [inbound] = await db
    .insert(inboundMessages)
    .values({
      fromEmail: fixture.email,
      subject: "Unmatched reply",
      rawText: "Can you send more information?"
    })
    .returning({ id: inboundMessages.id });
  assert.ok(inbound);

  const result = await attachInboundToThreadCommand({
    payload: {
      inboundMessageId: inbound.id,
      threadId: fixture.threadId
    }
  });
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail(`attach failed: ${result.failure.code}`);

  const [job] = await db
    .select({
      jobType: jobs.jobType,
      targetEntityId: jobs.targetEntityId,
      payloadJson: jobs.payloadJson,
      concurrencyKey: jobs.concurrencyKey
    })
    .from(jobs)
    .where(and(eq(jobs.targetEntityId, inbound.id), eq(jobs.jobType, "job.classify_reply")))
    .limit(1);
  assert.ok(job);
  assert.equal(job.targetEntityId, inbound.id);
  assert.equal(job.payloadJson["threadId"], fixture.threadId);
  assert.equal(job.concurrencyKey, `classify_reply:${inbound.id}`);
});

test("generate warm draft idempotency dedupes repeated clicks for same thread inbound and intent", async (t) => {
  const db = getDb();
  await clearT015Artifacts();
  t.after(clearT015Artifacts);

  const fixture = await insertStep9Fixture();
  const [inbound] = await db
    .insert(inboundMessages)
    .values({
      threadId: fixture.threadId,
      fromEmail: fixture.email,
      subject: "Re: Warm draft",
      rawText: "Yes, please send pricing."
    })
    .returning({ id: inboundMessages.id });
  assert.ok(inbound);

  const stableKeyA = buildGenerateWarmDraftIdempotencyKey(fixture.threadId, inbound.id, "intenthash");
  const stableKeyB = buildGenerateWarmDraftIdempotencyKey(fixture.threadId, inbound.id, "intenthash");
  assert.equal(stableKeyA, stableKeyB);

  const first = await generateWarmDraftCommand({
    payload: {
      threadId: fixture.threadId,
      replyIntent: "Send pricing details.",
      targetContactId: fixture.contactId
    }
  });
  assert.equal(first.ok, true);
  if (!first.ok) assert.fail(`warm draft command failed: ${first.failure.code}`);
  assert.equal(first.deduplicated, false);

  const second = await generateWarmDraftCommand({
    payload: {
      threadId: fixture.threadId,
      replyIntent: "Send pricing details.",
      targetContactId: fixture.contactId
    }
  });
  assert.equal(second.ok, true);
  if (!second.ok) assert.fail(`warm draft command failed: ${second.failure.code}`);
  assert.equal(second.deduplicated, true);
  assert.equal(second.command.id, first.command.id);
  assert.equal(second.job.id, first.job.id);

  const warmJobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.targetEntityId, fixture.threadId), eq(jobs.jobType, "job.generate_warm_draft")));
  assert.equal(warmJobs.length, 1);
});

async function insertStep9Fixture(input: {
  withOutbound?: boolean;
  withSnapshot?: boolean;
} = {}): Promise<{
  organizationId: string;
  campaignId: string;
  contactId: string;
  threadId: string;
  draftId: string;
  email: string;
}> {
  const db = getDb();
  const suffix = randomUUID();
  const email = `t015-${suffix}@example.com`;

  const [organization] = await db
    .insert(organizations)
    .values({ name: `t015-org-${suffix}`, domain: `t015-${suffix}.example` })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: `t015-campaign-${suffix}`,
      status: "active",
      objective: "Book demos for secure onboarding teams",
      targetSegments: ["T015"]
    })
    .returning({ id: campaigns.id });
  assert.ok(campaign);

  const [contact] = await db
    .insert(contacts)
    .values({ organizationId: organization.id, email, fullName: "T015 Buyer" })
    .returning({ id: contacts.id });
  assert.ok(contact);

  const [thread] = await db
    .insert(threads)
    .values({
      campaignId: campaign.id,
      organizationId: organization.id,
      status: "open",
      providerThreadKey: `t015-thread-${suffix}`
    })
    .returning({ id: threads.id });
  assert.ok(thread);

  await db.insert(threadParticipants).values({
    threadId: thread.id,
    contactId: contact.id,
    email,
    role: "recipient"
  });

  const [draft] = await db
    .insert(drafts)
    .values({
      campaignId: campaign.id,
      contactId: contact.id,
      threadId: thread.id,
      subject: `T015 subject ${suffix}`,
      body: "Prior outbound body for warm reply classification.",
      status: "approved",
      version: 1,
      claimsValidatedVersion: 1
    })
    .returning({ id: drafts.id });
  assert.ok(draft);

  await db.insert(draftVersions).values({
    draftId: draft.id,
    version: 1,
    subject: `T015 subject ${suffix}`,
    body: "Prior outbound body for warm reply classification.",
    bodyHash: `t015-${suffix}`,
    claimsValidatedVersion: 1,
    source: "agent_generated"
  });

  if (input.withOutbound) {
    await db.insert(outboundMessages).values({
      draftId: draft.id,
      threadId: thread.id,
      campaignId: campaign.id,
      contactId: contact.id,
      recipientEmail: email,
      provider: "resend",
      status: "sent",
      idempotencyKey: `t015-outbound:${suffix}`,
      payloadSnapshotJson: {
        recipientEmail: email,
        fromEmail: "sender@example.com",
        subject: `T015 subject ${suffix}`,
        body: "Prior outbound body for warm reply classification."
      }
    });
  }

  if (input.withSnapshot) {
    const [snapshot] = await db
      .insert(researchSnapshots)
      .values({
        organizationId: organization.id,
        snapshotVersion: 1,
        status: "active"
      })
      .returning({ id: researchSnapshots.id });
    assert.ok(snapshot);
    await db.insert(researchFacts).values({
      snapshotId: snapshot.id,
      factText: "T015 SnapshotCo uses SOC2 automation for customer onboarding.",
      status: "active",
      confidence: 85,
      safeForCopy: true
    });
  }

  return {
    organizationId: organization.id,
    campaignId: campaign.id,
    contactId: contact.id,
    threadId: thread.id,
    draftId: draft.id,
    email
  };
}

async function insertRunningClassifyJob(inboundMessageId: string): Promise<{
  job: LeasedJob;
  runId: string;
  workerId: string;
}> {
  const db = getDb();
  const jobId = randomUUID();
  const runId = randomUUID();
  const correlationId = randomUUID();
  const workerId = `t015-worker-${randomUUID()}`;

  await db.insert(jobs).values({
    id: jobId,
    jobType: "job.classify_reply",
    status: "running",
    workerPool: "background",
    targetEntityType: "inbound_message",
    targetEntityId: inboundMessageId,
    payloadJson: { inboundMessageId },
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
    runId,
    workerId,
    job: {
      id: jobId,
      job_type: "job.classify_reply",
      command_id: null,
      payload_json: { inboundMessageId },
      attempts: 1,
      max_attempts: 5,
      correlation_id: correlationId
    }
  };
}

async function clearT015Artifacts() {
  const db = getDb();
  const orgRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql`${organizations.name} like 't015-%'`);
  const orgIds = orgRows.map((row) => row.id);

  const campaignRows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(sql`${campaigns.name} like 't015-%'`);
  const campaignIds = campaignRows.map((row) => row.id);

  const contactRows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`${contacts.email} like 't015-%'`);
  const contactIds = contactRows.map((row) => row.id);

  const threadRows = orgIds.length > 0 || campaignIds.length > 0
    ? await db
        .select({ id: threads.id })
        .from(threads)
        .where(or(
          ...(orgIds.length > 0 ? [inArray(threads.organizationId, orgIds)] : []),
          ...(campaignIds.length > 0 ? [inArray(threads.campaignId, campaignIds)] : []),
          sql`${threads.providerThreadKey} like 't015-%'`
        ))
    : [];
  const threadIds = threadRows.map((row) => row.id);

  const inboundRows = threadIds.length > 0
    ? await db
        .select({ id: inboundMessages.id })
        .from(inboundMessages)
        .where(or(
          inArray(inboundMessages.threadId, threadIds),
          sql`${inboundMessages.fromEmail} like 't015-%'`
        ))
    : await db
        .select({ id: inboundMessages.id })
        .from(inboundMessages)
        .where(sql`${inboundMessages.fromEmail} like 't015-%'`);
  const inboundIds = inboundRows.map((row) => row.id);

  const draftRows = await db
    .select({ id: drafts.id })
    .from(drafts)
    .where(or(
      sql`${drafts.subject} like 'T015%'`,
      ...(contactIds.length > 0 ? [inArray(drafts.contactId, contactIds)] : []),
      ...(campaignIds.length > 0 ? [inArray(drafts.campaignId, campaignIds)] : []),
      ...(threadIds.length > 0 ? [inArray(drafts.threadId, threadIds)] : [])
    ));
  const draftIds = draftRows.map((row) => row.id);

  const outboundRows = draftIds.length > 0 || threadIds.length > 0 || contactIds.length > 0
    ? await db
        .select({ id: outboundMessages.id })
        .from(outboundMessages)
        .where(or(
          ...(draftIds.length > 0 ? [inArray(outboundMessages.draftId, draftIds)] : []),
          ...(threadIds.length > 0 ? [inArray(outboundMessages.threadId, threadIds)] : []),
          ...(contactIds.length > 0 ? [inArray(outboundMessages.contactId, contactIds)] : []),
          sql`${outboundMessages.recipientEmail} like 't015-%'`
        ))
    : [];
  const outboundIds = outboundRows.map((row) => row.id);

  const jobRows = inboundIds.length > 0 || threadIds.length > 0 || outboundIds.length > 0 || draftIds.length > 0
    ? await db
        .select({ id: jobs.id, commandId: jobs.commandId })
        .from(jobs)
        .where(or(
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

  const agentRunRows = jobIds.length > 0 || inboundIds.length > 0
    ? await db
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(or(
          ...(jobIds.length > 0 ? [inArray(agentRuns.jobId, jobIds)] : []),
          ...(inboundIds.length > 0 ? [sql`${agentRuns.inputSnapshotJson}->>'inboundMessageId' = any(${sql.raw(`array[${inboundIds.map((id) => `'${id}'`).join(",")}]::text[]`)})`] : [])
        ))
    : [];
  const agentRunIds = agentRunRows.map((row) => row.id);

  const snapshotRows = orgIds.length > 0
    ? await db.select({ id: researchSnapshots.id }).from(researchSnapshots).where(inArray(researchSnapshots.organizationId, orgIds))
    : [];
  const snapshotIds = snapshotRows.map((row) => row.id);

  const factRows = snapshotIds.length > 0
    ? await db.select({ id: researchFacts.id }).from(researchFacts).where(inArray(researchFacts.snapshotId, snapshotIds))
    : [];
  const factIds = factRows.map((row) => row.id);

  const eventEntityIds = [
    ...orgIds,
    ...campaignIds,
    ...contactIds,
    ...threadIds,
    ...inboundIds,
    ...draftIds,
    ...outboundIds,
    ...agentRunIds,
    ...jobIds
  ];
  if (eventEntityIds.length > 0 || commandIds.length > 0 || jobIds.length > 0) {
    await db.delete(eventLog).where(or(
      ...(eventEntityIds.length > 0 ? [inArray(eventLog.entityId, eventEntityIds)] : []),
      ...(commandIds.length > 0 ? [inArray(eventLog.commandId, commandIds)] : []),
      ...(jobIds.length > 0 ? [inArray(eventLog.jobId, jobIds)] : [])
    ));
  }

  if (agentRunIds.length > 0) {
    await db.delete(agentRunArtifacts).where(inArray(agentRunArtifacts.agentRunId, agentRunIds));
    await db.delete(agentRunEvents).where(inArray(agentRunEvents.agentRunId, agentRunIds));
  }
  if (inboundIds.length > 0) await db.delete(workItems).where(inArray(workItems.inboundMessageId, inboundIds));
  if (threadIds.length > 0) await db.delete(workItems).where(inArray(workItems.threadId, threadIds));
  if (outboundIds.length > 0) await db.delete(outboundMessages).where(inArray(outboundMessages.id, outboundIds));
  if (inboundIds.length > 0) await db.delete(inboundMessages).where(inArray(inboundMessages.id, inboundIds));
  if (draftIds.length > 0) {
    await db.delete(draftVersions).where(inArray(draftVersions.draftId, draftIds));
    await db.delete(drafts).where(inArray(drafts.id, draftIds));
  }
  if (agentRunIds.length > 0) await db.delete(agentRuns).where(inArray(agentRuns.id, agentRunIds));
  if (jobIds.length > 0) await db.delete(jobRuns).where(inArray(jobRuns.jobId, jobIds));
  if (jobIds.length > 0) await db.delete(jobs).where(inArray(jobs.id, jobIds));
  if (commandIds.length > 0) await db.delete(commands).where(inArray(commands.id, commandIds));
  if (threadIds.length > 0) await db.delete(threadParticipants).where(inArray(threadParticipants.threadId, threadIds));
  if (threadIds.length > 0) await db.delete(threads).where(inArray(threads.id, threadIds));
  if (contactIds.length > 0) await db.delete(contacts).where(inArray(contacts.id, contactIds));
  if (factIds.length > 0) await db.delete(researchFacts).where(inArray(researchFacts.id, factIds));
  if (snapshotIds.length > 0) await db.delete(researchSnapshots).where(inArray(researchSnapshots.id, snapshotIds));
  if (campaignIds.length > 0) await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
  if (orgIds.length > 0) await db.delete(organizations).where(inArray(organizations.id, orgIds));
}
