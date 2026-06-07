import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  agentRunArtifacts,
  agentRunEvents,
  agentRuns,
  applyWorkItemActionCommand,
  approveDraftForSendCommand,
  campaigns,
  closeDb,
  commands,
  completeGenerateWarmDraftJob,
  completeReviseDraftJob,
  contacts,
  discardDraftCommand,
  draftClaimFactRefs,
  draftClaims,
  draftFeedback,
  drafts,
  draftVersions,
  eventLog,
  getDb,
  inboundMessages,
  jobRuns,
  jobs,
  organizations,
  outboundMessages,
  ragChunks,
  ragDocuments,
  requestManualEditSaveCommand,
  threads,
  workItems,
  type AgentStageDispatcher,
  type LeasedJob
} from "../src";

after(async () => {
  await closeDb();
});

// All fixture rows in this file use the "fcl-" prefix so the cleanup below can
// scope its deletes. (The prompt-test file uses "fc-", so the two suites never
// step on each other.)
const PREFIX = "fcl-";

// ── job handle helpers (mirror the prompt-test fixtures) ──────────────────────

async function createReviseDraftJob(input: {
  organizationId: string;
  draftId: string;
  expectedVersion: number;
}): Promise<{ job: LeasedJob; runId: string; workerId: string }> {
  const db = getDb();
  const jobId = randomUUID();
  const runId = randomUUID();
  const workerId = `fcl-worker-${randomUUID()}`;
  const correlationId = randomUUID();
  const payloadJson = {
    organizationId: input.organizationId,
    draftId: input.draftId,
    expectedVersion: input.expectedVersion
  };

  await db.insert(jobs).values({
    id: jobId,
    jobType: "job.revise_draft",
    status: "running",
    workerPool: "drafting",
    targetEntityType: "draft",
    targetEntityId: input.draftId,
    payloadJson,
    leasedBy: workerId,
    leasedUntil: new Date(Date.now() + 60_000),
    attempts: 1,
    maxAttempts: 3,
    correlationId
  });

  await db.insert(jobRuns).values({ id: runId, jobId, status: "running", workerId, attempt: 1 });

  return {
    runId,
    workerId,
    job: {
      id: jobId,
      job_type: "job.revise_draft",
      command_id: null,
      payload_json: payloadJson,
      attempts: 1,
      max_attempts: 3,
      correlation_id: correlationId
    }
  };
}

async function createWarmDraftJob(input: {
  organizationId: string;
  threadId: string;
}): Promise<{ job: LeasedJob; runId: string; workerId: string }> {
  const db = getDb();
  const jobId = randomUUID();
  const runId = randomUUID();
  const workerId = `fcl-worker-${randomUUID()}`;
  const correlationId = randomUUID();
  const payloadJson = {
    organizationId: input.organizationId,
    threadId: input.threadId
  };

  await db.insert(jobs).values({
    id: jobId,
    jobType: "job.generate_warm_draft",
    status: "running",
    workerPool: "drafting",
    targetEntityType: "thread",
    targetEntityId: input.threadId,
    payloadJson,
    leasedBy: workerId,
    leasedUntil: new Date(Date.now() + 60_000),
    attempts: 1,
    maxAttempts: 3,
    correlationId
  });

  await db.insert(jobRuns).values({ id: runId, jobId, status: "running", workerId, attempt: 1 });

  return {
    runId,
    workerId,
    job: {
      id: jobId,
      job_type: "job.generate_warm_draft",
      command_id: null,
      payload_json: payloadJson,
      attempts: 1,
      max_attempts: 3,
      correlation_id: correlationId
    }
  };
}

// ── cleanup ───────────────────────────────────────────────────────────────────
//
// Lifecycle commands (approve/discard) write further than the prompt suite:
// draft_feedback + a RAG corpus artifact (rag_documents/rag_chunks + an
// index_rag_document job keyed on the document, not our org/draft) + outbound
// messages + commands. Delete everything reachable from our prefixed entities in
// FK order.
async function clearFclArtifacts() {
  const db = getDb();

  const orgRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql`${organizations.name} like ${PREFIX + "%"}`);
  const orgIds = orgRows.map((r) => r.id);

  const campaignRows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(sql`${campaigns.name} like ${PREFIX + "%"}`);
  const campaignIds = campaignRows.map((r) => r.id);

  const contactRows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`${contacts.email} like ${PREFIX + "%"}`);
  const contactIds = contactRows.map((r) => r.id);

  const threadRows = campaignIds.length > 0
    ? await db.select({ id: threads.id }).from(threads).where(inArray(threads.campaignId, campaignIds))
    : [];
  const threadIds = threadRows.map((r) => r.id);

  const draftRows =
    contactIds.length > 0 || campaignIds.length > 0 || threadIds.length > 0
      ? await db
          .select({ id: drafts.id })
          .from(drafts)
          .where(
            or(
              ...(contactIds.length > 0 ? [inArray(drafts.contactId, contactIds)] : []),
              ...(campaignIds.length > 0 ? [inArray(drafts.campaignId, campaignIds)] : []),
              ...(threadIds.length > 0 ? [inArray(drafts.threadId, threadIds)] : [])
            )
          )
      : [];
  const draftIds = draftRows.map((r) => r.id);

  const jobRows =
    orgIds.length > 0 || draftIds.length > 0 || threadIds.length > 0
      ? await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            or(
              ...(orgIds.length > 0 ? [inArray(jobs.targetEntityId, orgIds)] : []),
              ...(draftIds.length > 0 ? [inArray(jobs.targetEntityId, draftIds)] : []),
              ...(threadIds.length > 0 ? [inArray(jobs.targetEntityId, threadIds)] : [])
            )
          )
      : [];
  const jobIds = jobRows.map((r) => r.id);

  const agentRunRows = jobIds.length > 0
    ? await db.select({ id: agentRuns.id }).from(agentRuns).where(inArray(agentRuns.jobId, jobIds))
    : [];
  const agentRunIds = agentRunRows.map((r) => r.id);

  const claimRows = draftIds.length > 0
    ? await db.select({ id: draftClaims.id }).from(draftClaims).where(inArray(draftClaims.draftId, draftIds))
    : [];
  const claimIds = claimRows.map((r) => r.id);

  // draft_feedback rows -> rag corpus artifacts (one rag_document per feedback id).
  const feedbackRows = draftIds.length > 0
    ? await db.select({ id: draftFeedback.id }).from(draftFeedback).where(inArray(draftFeedback.draftId, draftIds))
    : [];
  const feedbackIds = feedbackRows.map((r) => r.id);

  // RAG corpus artifacts from approve/discard feedback are scoped to our org
  // (organization_id) or keyed by the feedback id — match either so the org FK
  // never blocks cleanup.
  const ragDocRows =
    feedbackIds.length > 0 || orgIds.length > 0
      ? await db
          .select({ id: ragDocuments.id })
          .from(ragDocuments)
          .where(
            or(
              ...(orgIds.length > 0 ? [inArray(ragDocuments.organizationId, orgIds)] : []),
              ...(feedbackIds.length > 0
                ? [
                    and(
                      eq(ragDocuments.sourceEntityType, "draft_feedback"),
                      inArray(ragDocuments.sourceEntityId, feedbackIds)
                    )
                  ]
                : [])
            )
          )
      : [];
  const ragDocIds = ragDocRows.map((r) => r.id);

  // index_rag_document jobs target the rag_document, not our org/draft.
  const ragJobRows = ragDocIds.length > 0
    ? await db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.targetEntityId, ragDocIds))
    : [];
  const ragJobIds = ragJobRows.map((r) => r.id);

  // approve writes an outbound_message + a send_email job (targets the outbound
  // message, references the approve command via command_id). discard/approve also
  // write commands targeting the draft; the snooze action writes a command
  // targeting the work item. Collect all of these so the jobs FK to commands and
  // the outbound-message FK clear cleanly.
  const outboundRows = draftIds.length > 0
    ? await db.select({ id: outboundMessages.id }).from(outboundMessages).where(inArray(outboundMessages.draftId, draftIds))
    : [];
  const outboundIds = outboundRows.map((r) => r.id);

  const commandRows = draftIds.length > 0
    ? await db
        .select({ id: commands.id })
        .from(commands)
        .where(and(eq(commands.targetEntityType, "draft"), inArray(commands.targetEntityId, draftIds)))
    : [];
  const draftCommandIds = commandRows.map((r) => r.id);

  // work-item action commands (snooze) target the work_item id, not the draft.
  const wiRows = draftIds.length > 0
    ? await db.select({ id: workItems.id }).from(workItems).where(inArray(workItems.draftId, draftIds))
    : [];
  const wiIds = wiRows.map((r) => r.id);
  const wiCommandRows = wiIds.length > 0
    ? await db
        .select({ id: commands.id })
        .from(commands)
        .where(and(eq(commands.targetEntityType, "work_item"), inArray(commands.targetEntityId, wiIds)))
    : [];
  const commandIds = Array.from(new Set([...draftCommandIds, ...wiCommandRows.map((r) => r.id)]));

  const commandJobRows = commandIds.length > 0
    ? await db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.commandId, commandIds))
    : [];
  const outboundJobRows = outboundIds.length > 0
    ? await db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.targetEntityId, outboundIds))
    : [];

  const allJobIds = Array.from(
    new Set([
      ...jobIds,
      ...ragJobIds,
      ...commandJobRows.map((r) => r.id),
      ...outboundJobRows.map((r) => r.id)
    ])
  );

  if (agentRunIds.length > 0) {
    await db.delete(agentRunArtifacts).where(inArray(agentRunArtifacts.agentRunId, agentRunIds));
    await db.delete(agentRunEvents).where(inArray(agentRunEvents.agentRunId, agentRunIds));
  }
  if (allJobIds.length > 0) {
    await db.delete(eventLog).where(inArray(eventLog.jobId, allJobIds));
  }
  if (ragDocIds.length > 0) {
    await db.delete(eventLog).where(inArray(eventLog.entityId, ragDocIds));
    await db.delete(ragChunks).where(inArray(ragChunks.documentId, ragDocIds));
  }
  if (draftIds.length > 0) {
    await db.delete(eventLog).where(inArray(eventLog.entityId, draftIds));
    await db.delete(workItems).where(inArray(workItems.draftId, draftIds));
    await db.delete(outboundMessages).where(inArray(outboundMessages.draftId, draftIds));
    await db.delete(draftFeedback).where(inArray(draftFeedback.draftId, draftIds));
  }
  if (ragDocIds.length > 0) {
    await db.delete(ragDocuments).where(inArray(ragDocuments.id, ragDocIds));
  }
  if (claimIds.length > 0) {
    await db.delete(draftClaimFactRefs).where(inArray(draftClaimFactRefs.draftClaimId, claimIds));
    await db.delete(draftClaims).where(inArray(draftClaims.id, claimIds));
  }
  // commands reference jobs via job.command_id and are referenced by
  // draft_feedback.source_command_id (cleared above) — delete after jobs.
  if (draftIds.length > 0) {
    await db.delete(draftVersions).where(inArray(draftVersions.draftId, draftIds));
    await db.delete(drafts).where(inArray(drafts.id, draftIds));
  }
  if (agentRunIds.length > 0) {
    await db.delete(agentRuns).where(inArray(agentRuns.id, agentRunIds));
  }
  if (allJobIds.length > 0) {
    await db.delete(jobRuns).where(inArray(jobRuns.jobId, allJobIds));
    await db.delete(jobs).where(inArray(jobs.id, allJobIds));
  }
  if (commandIds.length > 0) {
    await db.delete(eventLog).where(inArray(eventLog.commandId, commandIds));
    await db.delete(commands).where(inArray(commands.id, commandIds));
  }
  if (threadIds.length > 0) {
    await db.delete(inboundMessages).where(inArray(inboundMessages.threadId, threadIds));
    await db.delete(threads).where(inArray(threads.id, threadIds));
  }
  if (contactIds.length > 0) await db.delete(contacts).where(inArray(contacts.id, contactIds));
  if (campaignIds.length > 0) await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
  if (orgIds.length > 0) await db.delete(organizations).where(inArray(organizations.id, orgIds));
}

// Insert a base org + campaign (with forbiddenClaims) + contact, return ids.
async function seedCampaign(input: {
  suffix: string;
  forbiddenClaims: string[];
  senderSignature?: string;
  status?: string;
}): Promise<{ orgId: string; campaignId: string; contactId: string; email: string }> {
  const db = getDb();
  const email = `${PREFIX}${input.suffix}@example.com`;

  const [org] = await db
    .insert(organizations)
    .values({ name: `${PREFIX}org-${input.suffix}`, domain: `${PREFIX}${input.suffix}.example` })
    .returning({ id: organizations.id });
  assert.ok(org);

  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: `${PREFIX}campaign-${input.suffix}`,
      objective: "Book discovery calls.",
      targetSegments: ["fintech"],
      forbiddenClaims: input.forbiddenClaims,
      ...(input.senderSignature ? { senderSignature: input.senderSignature } : {}),
      ...(input.status ? { status: input.status } : {})
    })
    .returning({ id: campaigns.id });
  assert.ok(campaign);

  const [contact] = await db
    .insert(contacts)
    .values({ organizationId: org.id, email, fullName: "FCL Buyer" })
    .returning({ id: contacts.id });
  assert.ok(contact);

  return { orgId: org.id, campaignId: campaign.id, contactId: contact.id, email };
}

// Insert a cold draft head + v1 version row. Optionally add a "supported" claim
// (so recomputeDraftScores lifts readiness off `not_ready`, letting approve pass
// the readiness guardrail).
async function seedColdDraft(input: {
  suffix: string;
  campaignId: string;
  contactId: string;
  subject: string;
  body: string;
  withSupportedClaim?: boolean;
}): Promise<string> {
  const db = getDb();
  const [draft] = await db
    .insert(drafts)
    .values({
      campaignId: input.campaignId,
      contactId: input.contactId,
      subject: input.subject,
      body: input.body,
      status: "draft",
      version: 1,
      kind: "cold",
      claimsValidatedVersion: 1
    })
    .returning({ id: drafts.id });
  assert.ok(draft);

  await db.insert(draftVersions).values({
    draftId: draft.id,
    version: 1,
    subject: input.subject,
    body: input.body,
    bodyHash: `${PREFIX}hash-${input.suffix}-${randomUUID()}`,
    source: "agent_generated"
  });

  if (input.withSupportedClaim) {
    await db.insert(draftClaims).values({
      draftId: draft.id,
      claimText: "We help fintech teams ship faster.",
      safety: "supported"
    });
  }

  return draft.id;
}

// Insert an OPEN forbidden-claim flag for a draft@version with the canonical
// dedupeKey, mirroring what flagForbiddenClaims would have created.
async function seedOpenForbiddenFlag(input: {
  draftId: string;
  organizationId: string;
  campaignId: string;
  version: number;
}): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(workItems)
    .values({
      type: "draft_forbidden_claim_hit",
      status: "open",
      priority: 75,
      sourceEntityType: "draft",
      sourceEntityId: input.draftId,
      title: "Forbidden claim in draft",
      summary: "seeded forbidden claim flag",
      reasonCode: "forbidden_claim_detected",
      actionLabel: "Review draft",
      dedupeKey: `draft_forbidden_claim:${input.draftId}:v${input.version}`,
      draftId: input.draftId,
      organizationId: input.organizationId,
      campaignId: input.campaignId
    })
    .returning({ id: workItems.id });
  assert.ok(row);
  return row.id;
}

async function forbiddenFlags(draftId: string) {
  const db = getDb();
  return db
    .select({ id: workItems.id, status: workItems.status, dedupeKey: workItems.dedupeKey })
    .from(workItems)
    .where(and(eq(workItems.draftId, draftId), eq(workItems.type, "draft_forbidden_claim_hit")));
}

const RESOLVED_LIKE = new Set(["resolved", "dismissed", "superseded"]);

// ── tests ─────────────────────────────────────────────────────────────────────

// CASE 1 — warm generation hit (campaign-scoped via thread).
test("lifecycle 1 — warm generation hit raises a campaign-scoped flag", async (t) => {
  const db = getDb();
  await clearFclArtifacts();
  t.after(clearFclArtifacts);

  const suffix = randomUUID();
  const { orgId, campaignId, contactId, email } = await seedCampaign({
    suffix,
    forbiddenClaims: ["guaranteed ROI"]
  });

  const [thread] = await db
    .insert(threads)
    .values({ campaignId, organizationId: orgId, status: "open" })
    .returning({ id: threads.id });
  assert.ok(thread);

  const [inbound] = await db
    .insert(inboundMessages)
    .values({ threadId: thread.id, fromEmail: email, subject: "Re: outreach", rawText: "Tell me more." })
    .returning({ id: inboundMessages.id });
  assert.ok(inbound);

  const jobHandle = await createWarmDraftJob({ organizationId: orgId, threadId: thread.id });

  const dispatcher: AgentStageDispatcher = async function* () {
    yield {
      eventType: "final_response",
      payloadJson: {
        text: JSON.stringify({
          subject: "Re: outreach",
          body: "Absolutely — we deliver Guaranteed ROI on every engagement.",
          claims: []
        })
      }
    };
  };

  await completeGenerateWarmDraftJob({
    ...jobHandle,
    threadId: thread.id,
    organizationId: orgId,
    replyIntent: "Acknowledge interest.",
    latestInboundMessageId: inbound.id,
    contactId,
    dispatcher
  });

  const [draftRow] = await db
    .select({ id: drafts.id })
    .from(drafts)
    .where(eq(drafts.threadId, thread.id))
    .limit(1);
  assert.ok(draftRow);

  const flags = await forbiddenFlags(draftRow.id);
  assert.equal(flags.length, 1);
  assert.equal(flags[0]!.status, "open");
  assert.equal(flags[0]!.dedupeKey, `draft_forbidden_claim:${draftRow.id}:v1`);

  // Campaign-scoped via the thread.
  const [wi] = await db
    .select({ campaignId: workItems.campaignId })
    .from(workItems)
    .where(eq(workItems.id, flags[0]!.id));
  assert.equal(wi?.campaignId, campaignId);

  const events = await db
    .select({ id: eventLog.id, payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(and(eq(eventLog.eventType, "draft_email_forbidden_claim_hit"), eq(eventLog.entityId, draftRow.id)));
  assert.equal(events.length, 1);
  assert.equal((events[0]!.payloadJson as Record<string, unknown>)["campaignId"], campaignId);
});

// CASE 2 — revise supersede (clean): prior open flag resolved, no new open flag.
test("lifecycle 2 — clean revise resolves the prior flag and opens none", async (t) => {
  const db = getDb();
  await clearFclArtifacts();
  t.after(clearFclArtifacts);

  const suffix = randomUUID();
  const { orgId, campaignId, contactId } = await seedCampaign({
    suffix,
    forbiddenClaims: ["guaranteed ROI"]
  });
  const draftId = await seedColdDraft({
    suffix,
    campaignId,
    contactId,
    subject: "Intro",
    body: "We promise Guaranteed ROI."
  });
  const priorFlagId = await seedOpenForbiddenFlag({ draftId, organizationId: orgId, campaignId, version: 1 });

  const jobHandle = await createReviseDraftJob({ organizationId: orgId, draftId, expectedVersion: 1 });
  const dispatcher: AgentStageDispatcher = async function* () {
    yield {
      eventType: "final_response",
      payloadJson: {
        text: JSON.stringify({ subject: "Intro revised", body: "We help teams ship faster.", claims: [] })
      }
    };
  };

  await completeReviseDraftJob({
    ...jobHandle,
    draftId,
    expectedVersion: 1,
    organizationId: orgId,
    operatorFeedback: "Drop the promise.",
    dispatcher
  });

  const flags = await forbiddenFlags(draftId);
  const prior = flags.find((f) => f.id === priorFlagId);
  assert.ok(prior);
  assert.ok(RESOLVED_LIKE.has(prior.status), `prior flag should be resolved, got ${prior.status}`);

  const openFlags = flags.filter((f) => !RESOLVED_LIKE.has(f.status));
  assert.equal(openFlags.length, 0);
});

// CASE 3 — revise re-flag: reintroduced phrase opens a NEW version-scoped flag.
test("lifecycle 3 — revise reintroducing a phrase opens a v2-scoped flag", async (t) => {
  const db = getDb();
  await clearFclArtifacts();
  t.after(clearFclArtifacts);

  const suffix = randomUUID();
  const { orgId, campaignId, contactId } = await seedCampaign({
    suffix,
    forbiddenClaims: ["cures everything"]
  });
  const draftId = await seedColdDraft({
    suffix,
    campaignId,
    contactId,
    subject: "Intro",
    body: "A clean opening line."
  });
  const priorFlagId = await seedOpenForbiddenFlag({ draftId, organizationId: orgId, campaignId, version: 1 });

  const jobHandle = await createReviseDraftJob({ organizationId: orgId, draftId, expectedVersion: 1 });
  const dispatcher: AgentStageDispatcher = async function* () {
    yield {
      eventType: "final_response",
      payloadJson: {
        text: JSON.stringify({ subject: "Intro", body: "Our product Cures Everything, trust us.", claims: [] })
      }
    };
  };

  await completeReviseDraftJob({
    ...jobHandle,
    draftId,
    expectedVersion: 1,
    organizationId: orgId,
    operatorFeedback: "Make it bolder.",
    dispatcher
  });

  const flags = await forbiddenFlags(draftId);
  const prior = flags.find((f) => f.id === priorFlagId);
  assert.ok(prior);
  assert.ok(RESOLVED_LIKE.has(prior.status), `prior v1 flag should be resolved, got ${prior.status}`);

  const v2 = flags.find((f) => f.dedupeKey === `draft_forbidden_claim:${draftId}:v2`);
  assert.ok(v2, "a v2-scoped flag must exist");
  assert.equal(v2.status, "open");
});

// CASE 4 — manual-edit hit: saving a forbidden phrase creates a flag (prior resolved).
test("lifecycle 4 — manual edit with a forbidden phrase flags and resolves prior", async (t) => {
  await clearFclArtifacts();
  t.after(clearFclArtifacts);

  const suffix = randomUUID();
  const { orgId, campaignId, contactId } = await seedCampaign({
    suffix,
    forbiddenClaims: ["guaranteed ROI"]
  });
  const draftId = await seedColdDraft({
    suffix,
    campaignId,
    contactId,
    subject: "Intro",
    body: "A clean opening line."
  });
  const priorFlagId = await seedOpenForbiddenFlag({ draftId, organizationId: orgId, campaignId, version: 1 });

  const result = await requestManualEditSaveCommand({
    payload: {
      draftId,
      expectedVersion: 1,
      subject: "Intro",
      body: "We offer Guaranteed ROI to all clients."
    }
  });
  assert.equal(result.ok, true);

  const flags = await forbiddenFlags(draftId);
  const prior = flags.find((f) => f.id === priorFlagId);
  assert.ok(prior);
  assert.ok(RESOLVED_LIKE.has(prior.status), `prior flag should be resolved, got ${prior.status}`);

  // The manual edit bumped the head to v2; the new flag is v2-scoped and open.
  const v2 = flags.find((f) => f.dedupeKey === `draft_forbidden_claim:${draftId}:v2`);
  assert.ok(v2, "a v2-scoped flag must exist for the manual edit");
  assert.equal(v2.status, "open");
});

// CASE 5 — approve resolves an open flag.
test("lifecycle 5 — approving a draft resolves its open flag", async (t) => {
  const db = getDb();
  await clearFclArtifacts();
  t.after(clearFclArtifacts);

  const suffix = randomUUID();
  const { orgId, campaignId, contactId } = await seedCampaign({
    suffix,
    forbiddenClaims: ["guaranteed ROI"],
    status: "active"
  });
  // withSupportedClaim lifts readiness off `not_ready` so approve clears the
  // pre-send readiness guardrail and reaches the flag-resolution step.
  const draftId = await seedColdDraft({
    suffix,
    campaignId,
    contactId,
    subject: "Intro",
    body: "We help fintech teams ship faster.",
    withSupportedClaim: true
  });
  const flagId = await seedOpenForbiddenFlag({ draftId, organizationId: orgId, campaignId, version: 1 });

  const result = await approveDraftForSendCommand({
    payload: { draftId, draftVersion: 1 },
    fromEmail: `${PREFIX}sender-${suffix}@example.com`
  });
  assert.equal(result.ok, true, `approve should succeed: ${JSON.stringify(result)}`);

  const [flag] = await db
    .select({ status: workItems.status })
    .from(workItems)
    .where(eq(workItems.id, flagId));
  assert.ok(flag);
  assert.ok(RESOLVED_LIKE.has(flag.status), `flag should be resolved after approve, got ${flag.status}`);
});

// CASE 6 — discard resolves an open flag.
test("lifecycle 6 — discarding a draft resolves its open flag", async (t) => {
  const db = getDb();
  await clearFclArtifacts();
  t.after(clearFclArtifacts);

  const suffix = randomUUID();
  const { orgId, campaignId, contactId } = await seedCampaign({
    suffix,
    forbiddenClaims: ["guaranteed ROI"]
  });
  const draftId = await seedColdDraft({
    suffix,
    campaignId,
    contactId,
    subject: "Intro",
    body: "We promise Guaranteed ROI."
  });
  const flagId = await seedOpenForbiddenFlag({ draftId, organizationId: orgId, campaignId, version: 1 });

  const result = await discardDraftCommand({
    payload: { draftId, expectedVersion: 1, reason: "Contains a forbidden claim." }
  });
  assert.equal(result.ok, true, `discard should succeed: ${JSON.stringify(result)}`);

  const [flag] = await db
    .select({ status: workItems.status })
    .from(workItems)
    .where(eq(workItems.id, flagId));
  assert.ok(flag);
  assert.ok(RESOLVED_LIKE.has(flag.status), `flag should be resolved after discard, got ${flag.status}`);
});

// CASE 7 — F1 regression: a SNOOZED (non-open active) flag is still resolved.
test("lifecycle 7 — a snoozed flag is resolved by a clean discard (F1 regression)", async (t) => {
  const db = getDb();
  await clearFclArtifacts();
  t.after(clearFclArtifacts);

  const suffix = randomUUID();
  const { orgId, campaignId, contactId } = await seedCampaign({
    suffix,
    forbiddenClaims: ["guaranteed ROI"]
  });
  const draftId = await seedColdDraft({
    suffix,
    campaignId,
    contactId,
    subject: "Intro",
    body: "We promise Guaranteed ROI."
  });
  const flagId = await seedOpenForbiddenFlag({ draftId, organizationId: orgId, campaignId, version: 1 });

  // Move the flag to "snoozed" via the generic work-item action handler.
  await applyWorkItemActionCommand({ workItemId: flagId, action: "snooze", snoozeMinutes: 60 });
  const [snoozed] = await db
    .select({ status: workItems.status })
    .from(workItems)
    .where(eq(workItems.id, flagId));
  assert.equal(snoozed?.status, "snoozed");

  // A clean discard must resolve it — the fix targets `status not in
  // (resolved,dismissed,superseded)`, i.e. it covers snoozed too, not just open.
  const result = await discardDraftCommand({
    payload: { draftId, expectedVersion: 1, reason: "No longer needed." }
  });
  assert.equal(result.ok, true, `discard should succeed: ${JSON.stringify(result)}`);

  const [flag] = await db
    .select({ status: workItems.status })
    .from(workItems)
    .where(eq(workItems.id, flagId));
  assert.ok(flag);
  assert.ok(RESOLVED_LIKE.has(flag.status), `snoozed flag should be resolved, got ${flag.status}`);
});

// CASE 8 — F6/F7 regression: revise FLAGGING on a LEGACY warm draft (campaignId
// NULL on the row) resolves the campaign via the thread fallback. Both the work
// item AND the event must be scoped to the thread's campaign, not null. This
// catches a regression where completeReviseDraftJob fails to pass
// threads.campaignId into flagForbiddenClaims.
test("lifecycle 8 — revise flag on a legacy warm draft scopes campaignId via the thread", async (t) => {
  const db = getDb();
  await clearFclArtifacts();
  t.after(clearFclArtifacts);

  const suffix = randomUUID();
  const { orgId, campaignId, contactId } = await seedCampaign({
    suffix,
    forbiddenClaims: ["guaranteed ROI"]
  });

  // Thread linked to the campaign.
  const [thread] = await db
    .insert(threads)
    .values({ campaignId, organizationId: orgId, status: "open" })
    .returning({ id: threads.id });
  assert.ok(thread);

  // LEGACY warm draft: kind="warm", campaignId NULL, threadId set. The flag path
  // must fall back to threads.campaignId for scoping.
  const [draft] = await db
    .insert(drafts)
    .values({
      campaignId: null,
      contactId,
      threadId: thread.id,
      subject: "Re: Warm subject",
      body: "Hi, a clean warm reply here.",
      status: "draft",
      version: 1,
      kind: "warm",
      claimsValidatedVersion: 1
    })
    .returning({ id: drafts.id });
  assert.ok(draft);

  await db.insert(draftVersions).values({
    draftId: draft.id,
    version: 1,
    subject: "Re: Warm subject",
    body: "Hi, a clean warm reply here.",
    bodyHash: `${PREFIX}warm-hash-${suffix}-${randomUUID()}`,
    source: "agent_generated"
  });

  const jobHandle = await createReviseDraftJob({ organizationId: orgId, draftId: draft.id, expectedVersion: 1 });
  const dispatcher: AgentStageDispatcher = async function* () {
    yield {
      eventType: "final_response",
      payloadJson: {
        text: JSON.stringify({
          subject: "Re: Warm subject revised",
          body: "Reply revised — we deliver Guaranteed ROI on every engagement.",
          claims: []
        })
      }
    };
  };

  await completeReviseDraftJob({
    ...jobHandle,
    draftId: draft.id,
    expectedVersion: 1,
    organizationId: orgId,
    operatorFeedback: "Make it bolder.",
    dispatcher
  });

  // 1. The created flag (v2-scoped) is campaign-scoped via the thread fallback.
  const v2 = (await forbiddenFlags(draft.id)).find(
    (f) => f.dedupeKey === `draft_forbidden_claim:${draft.id}:v2`
  );
  assert.ok(v2, "a v2-scoped flag must exist for the reintroduced phrase");
  assert.equal(v2.status, "open");

  const [wi] = await db
    .select({ campaignId: workItems.campaignId })
    .from(workItems)
    .where(eq(workItems.id, v2.id));
  assert.equal(wi?.campaignId, campaignId);

  // 2. The event_log row's payload is scoped to the thread's campaign, not null.
  const events = await db
    .select({ id: eventLog.id, payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(
      and(eq(eventLog.eventType, "draft_email_forbidden_claim_hit"), eq(eventLog.entityId, draft.id))
    );
  assert.equal(events.length, 1);
  assert.equal((events[0]!.payloadJson as Record<string, unknown>)["campaignId"], campaignId);
});
