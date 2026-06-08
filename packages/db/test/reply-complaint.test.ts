import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { nonOverridableGuardrailCodes } from "@bizdev/shared";
import {
  agentRuns,
  campaigns,
  closeDb,
  contacts,
  drafts,
  eventLog,
  evaluatePreSendGuardrails,
  getDb,
  inboundMessages,
  jobs,
  organizations,
  routeClassifyReplyOutcome,
  suppressionEntries,
  workItems
} from "../src";

after(async () => {
  await closeDb();
});

test("reply-complaint writes canonical hard suppression reason", async (t) => {
  const db = getDb();
  const correlationId = randomUUID();
  const email = `reply-complaint-${randomUUID()}@example.com`;
  const ids: { campaignId?: string; organizationId?: string; contactId?: string; draftId?: string; inboundId?: string; agentRunId?: string } = {};

  t.after(async () => {
    if (ids.inboundId) {
      await db.delete(jobs).where(sql`${jobs.correlationId} = ${correlationId}`);
      await db.delete(workItems).where(eq(workItems.sourceEntityId, ids.inboundId));
    }
    await db.execute(sql`delete from event_log where correlation_id = ${correlationId}`);
    await db.delete(suppressionEntries).where(eq(suppressionEntries.email, email));
    if (ids.inboundId) await db.delete(inboundMessages).where(eq(inboundMessages.id, ids.inboundId));
    if (ids.draftId) await db.delete(drafts).where(eq(drafts.id, ids.draftId));
    if (ids.agentRunId) await db.delete(agentRuns).where(eq(agentRuns.id, ids.agentRunId));
    if (ids.contactId) await db.delete(contacts).where(eq(contacts.id, ids.contactId));
    if (ids.organizationId) await db.delete(organizations).where(eq(organizations.id, ids.organizationId));
    if (ids.campaignId) await db.delete(campaigns).where(eq(campaigns.id, ids.campaignId));
  });

  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: "T-026BY complaint test",
      objective: "Verify reply complaint hard suppression",
      targetSegments: []
    })
    .returning({ id: campaigns.id });
  assert.ok(campaign);
  ids.campaignId = campaign.id;

  const [organization] = await db
    .insert(organizations)
    .values({ name: "T-026BY Test Org", domain: "t026by.example.com" })
    .returning({ id: organizations.id });
  assert.ok(organization);
  ids.organizationId = organization.id;

  const [contact] = await db
    .insert(contacts)
    .values({ organizationId: organization.id, email, fullName: "Reply Complaint" })
    .returning({ id: contacts.id });
  assert.ok(contact);
  ids.contactId = contact.id;

  const [draft] = await db
    .insert(drafts)
    .values({
      campaignId: campaign.id,
      contactId: contact.id,
      subject: "Hello",
      body: "Short body",
      claimsValidatedVersion: 1
    })
    .returning({ id: drafts.id });
  assert.ok(draft);
  ids.draftId = draft.id;

  const [inbound] = await db
    .insert(inboundMessages)
    .values({
      fromEmail: email,
      subject: "Re: Hello",
      rawText: "Stop emailing me, this is spam."
    })
    .returning({ id: inboundMessages.id });
  assert.ok(inbound);
  ids.inboundId = inbound.id;

  const [agentRun] = await db
    .insert(agentRuns)
    .values({
      stage: "classify_reply",
      status: "succeeded",
      inputSnapshotJson: { inboundMessageId: inbound.id },
      outputJson: { class: "complaint" }
    })
    .returning({ id: agentRuns.id });
  assert.ok(agentRun);
  ids.agentRunId = agentRun.id;

  const result = await routeClassifyReplyOutcome({
    agentRunId: agentRun.id,
    inboundMessageId: inbound.id,
    finalText: JSON.stringify({
      class: "complaint",
      confidence: "high",
      reasoning: "Recipient called the outreach spam and demanded it stop.",
      signals: ["this is spam", "stop emailing me"]
    }),
    correlationId
  });
  assert.deepEqual(result, { replyClass: "complaint", confidence: "high" });

  const [suppression] = await db
    .select({ reason: suppressionEntries.reason, source: suppressionEntries.source, active: suppressionEntries.active })
    .from(suppressionEntries)
    .where(eq(suppressionEntries.email, email))
    .limit(1);
  assert.deepEqual(suppression, {
    reason: "complaint",
    source: "reply_classification",
    active: true
  });

  const guardrails = await evaluatePreSendGuardrails({
    draftId: draft.id,
    recipientEmail: email,
    contactId: contact.id
  });
  const suppressionFailure = guardrails.failures.find((failure) => failure.code === "active_suppression_hard");
  assert.ok(suppressionFailure);
  assert.equal(suppressionFailure.metadata?.reason, "complaint");
  assert.equal(suppressionFailure.metadata?.overridable, false);
  assert.ok((nonOverridableGuardrailCodes as readonly string[]).includes(suppressionFailure.code));
  assert.equal(guardrails.failures.some((failure) => failure.code === "active_suppression_soft"), false);

  const suppressionEvents = await db
    .select({ payload: eventLog.payloadJson })
    .from(eventLog)
    .where(sql`${eventLog.correlationId} = ${correlationId} and ${eventLog.eventType} = 'suppression_entry_created'`);
  assert.equal(suppressionEvents.length, 1);
  assert.equal(suppressionEvents[0]?.payload.reason, "complaint");
  assert.equal(suppressionEvents[0]?.payload.source, "reply_classification");
  assert.equal(suppressionEvents[0]?.payload.reactivated, false);
  assert.equal(suppressionEvents[0]?.payload.updatedReason, false);
});

test("reply-complaint routing is idempotent across repeated complaint replies", async (t) => {
  const db = getDb();
  const correlationId = randomUUID();
  const email = `complaint-idempotent-${randomUUID()}@example.com`;
  const ids: { inboundIds: string[]; agentRunIds: string[] } = { inboundIds: [], agentRunIds: [] };

  t.after(async () => {
    await db.delete(jobs).where(sql`${jobs.correlationId} = ${correlationId}`);
    for (const inboundId of ids.inboundIds) {
      await db.delete(workItems).where(eq(workItems.sourceEntityId, inboundId));
      await db.delete(inboundMessages).where(eq(inboundMessages.id, inboundId));
    }
    await db.execute(sql`delete from event_log where correlation_id = ${correlationId}`);
    await db.delete(suppressionEntries).where(sql`lower(${suppressionEntries.email}) = ${email}`);
    for (const agentRunId of ids.agentRunIds) {
      await db.delete(agentRuns).where(eq(agentRuns.id, agentRunId));
    }
  });

  // Two separate complaint replies from the same person must converge on a
  // single active suppression row — no duplicate inserts on the second route.
  for (let i = 0; i < 2; i++) {
    const [inbound] = await db
      .insert(inboundMessages)
      .values({ fromEmail: email, subject: `Re: Hello ${i}`, rawText: "this is spam" })
      .returning({ id: inboundMessages.id });
    assert.ok(inbound);
    ids.inboundIds.push(inbound.id);

    const [agentRun] = await db
      .insert(agentRuns)
      .values({
        stage: "classify_reply",
        status: "succeeded",
        inputSnapshotJson: { inboundMessageId: inbound.id },
        outputJson: { class: "complaint" }
      })
      .returning({ id: agentRuns.id });
    assert.ok(agentRun);
    ids.agentRunIds.push(agentRun.id);

    await routeClassifyReplyOutcome({
      agentRunId: agentRun.id,
      inboundMessageId: inbound.id,
      finalText: JSON.stringify({ class: "complaint", confidence: "high" }),
      correlationId
    });
  }

  const activeComplaints = await db
    .select({ id: suppressionEntries.id })
    .from(suppressionEntries)
    .where(sql`
      lower(${suppressionEntries.email}) = ${email}
      and ${suppressionEntries.active} = true
      and ${suppressionEntries.reason} = 'complaint'
    `);
  assert.equal(activeComplaints.length, 1);

  // First route inserts the suppression (one event); the second reuses the
  // already-active complaint row and must NOT emit a duplicate event.
  const suppressionEvents = await db
    .select({ id: eventLog.id })
    .from(eventLog)
    .where(sql`${eventLog.correlationId} = ${correlationId} and ${eventLog.eventType} = 'suppression_entry_created'`);
  assert.equal(suppressionEvents.length, 1);
});

test("reply-complaint routing reactivates a prior inactive suppression", async (t) => {
  const db = getDb();
  const correlationId = randomUUID();
  const email = `complaint-reactivate-${randomUUID()}@example.com`;
  const ids: { inboundId?: string; agentRunId?: string; suppressionId?: string } = {};

  t.after(async () => {
    if (ids.inboundId) {
      await db.delete(jobs).where(sql`${jobs.correlationId} = ${correlationId}`);
      await db.delete(workItems).where(eq(workItems.sourceEntityId, ids.inboundId));
      await db.delete(inboundMessages).where(eq(inboundMessages.id, ids.inboundId));
    }
    await db.execute(sql`delete from event_log where correlation_id = ${correlationId}`);
    await db.delete(suppressionEntries).where(sql`lower(${suppressionEntries.email}) = ${email}`);
    if (ids.agentRunId) await db.delete(agentRuns).where(eq(agentRuns.id, ids.agentRunId));
  });

  const [suppression] = await db
    .insert(suppressionEntries)
    .values({
      email,
      reason: "do_not_contact",
      source: "operator",
      active: false
    })
    .returning({ id: suppressionEntries.id });
  assert.ok(suppression);
  ids.suppressionId = suppression.id;

  const [inbound] = await db
    .insert(inboundMessages)
    .values({ fromEmail: email, subject: "Re: Hello", rawText: "this is spam, stop" })
    .returning({ id: inboundMessages.id });
  assert.ok(inbound);
  ids.inboundId = inbound.id;

  const [agentRun] = await db
    .insert(agentRuns)
    .values({
      stage: "classify_reply",
      status: "succeeded",
      inputSnapshotJson: { inboundMessageId: inbound.id },
      outputJson: { class: "complaint" }
    })
    .returning({ id: agentRuns.id });
  assert.ok(agentRun);
  ids.agentRunId = agentRun.id;

  await routeClassifyReplyOutcome({
    agentRunId: agentRun.id,
    inboundMessageId: inbound.id,
    finalText: JSON.stringify({ class: "complaint", confidence: "high" }),
    correlationId
  });

  const [afterRow] = await db
    .select({ active: suppressionEntries.active, reason: suppressionEntries.reason, source: suppressionEntries.source })
    .from(suppressionEntries)
    .where(eq(suppressionEntries.id, suppression.id))
    .limit(1);
  assert.deepEqual(afterRow, { active: true, reason: "complaint", source: "reply_classification" });
});

test("reply-complaint routing reuses an active provider complaint without clobbering source", async (t) => {
  const db = getDb();
  const correlationId = randomUUID();
  const email = `complaint-provider-active-${randomUUID()}@example.com`;
  const ids: { inboundId?: string; agentRunId?: string; suppressionId?: string } = {};

  t.after(async () => {
    if (ids.inboundId) {
      await db.delete(jobs).where(sql`${jobs.correlationId} = ${correlationId}`);
      await db.delete(workItems).where(eq(workItems.sourceEntityId, ids.inboundId));
      await db.delete(inboundMessages).where(eq(inboundMessages.id, ids.inboundId));
    }
    await db.execute(sql`delete from event_log where correlation_id = ${correlationId}`);
    await db.delete(suppressionEntries).where(sql`lower(${suppressionEntries.email}) = ${email}`);
    if (ids.agentRunId) await db.delete(agentRuns).where(eq(agentRuns.id, ids.agentRunId));
  });

  // A provider-attested complaint (Resend webhook) already hard-suppressed this
  // address. A reply complaint must reuse it untouched — its provider source
  // attribution must survive, and no duplicate event is written.
  const [suppression] = await db
    .insert(suppressionEntries)
    .values({ email, reason: "complaint", source: "resend", active: true })
    .returning({ id: suppressionEntries.id });
  assert.ok(suppression);
  ids.suppressionId = suppression.id;

  const routed = await routeComplaintReply(db, email, correlationId);
  ids.inboundId = routed.inboundId;
  ids.agentRunId = routed.agentRunId;

  const [row] = await db
    .select({ active: suppressionEntries.active, reason: suppressionEntries.reason, source: suppressionEntries.source })
    .from(suppressionEntries)
    .where(eq(suppressionEntries.id, suppression.id))
    .limit(1);
  assert.deepEqual(row, { active: true, reason: "complaint", source: "resend" });

  const suppressionEvents = await db
    .select({ id: eventLog.id })
    .from(eventLog)
    .where(sql`${eventLog.correlationId} = ${correlationId} and ${eventLog.eventType} = 'suppression_entry_created'`);
  assert.equal(suppressionEvents.length, 0);
});

test("reply-complaint routing reactivates an inactive provider complaint, preserving the provider source", async (t) => {
  const db = getDb();
  const correlationId = randomUUID();
  const email = `complaint-provider-inactive-${randomUUID()}@example.com`;
  const ids: { inboundId?: string; agentRunId?: string; suppressionId?: string } = {};

  t.after(async () => {
    if (ids.inboundId) {
      await db.delete(jobs).where(sql`${jobs.correlationId} = ${correlationId}`);
      await db.delete(workItems).where(eq(workItems.sourceEntityId, ids.inboundId));
      await db.delete(inboundMessages).where(eq(inboundMessages.id, ids.inboundId));
    }
    await db.execute(sql`delete from event_log where correlation_id = ${correlationId}`);
    await db.delete(suppressionEntries).where(sql`lower(${suppressionEntries.email}) = ${email}`);
    if (ids.agentRunId) await db.delete(agentRuns).where(eq(agentRuns.id, ids.agentRunId));
  });

  // A provider complaint was later deactivated (operator lifted it). A reply
  // complaint reactivates it — but the provider attribution (source=resend)
  // must NOT be overwritten with reply_classification; only the reason-changing
  // upgrade path rewrites source.
  const [suppression] = await db
    .insert(suppressionEntries)
    .values({ email, reason: "complaint", source: "resend", active: false })
    .returning({ id: suppressionEntries.id });
  assert.ok(suppression);
  ids.suppressionId = suppression.id;

  const routed = await routeComplaintReply(db, email, correlationId);
  ids.inboundId = routed.inboundId;
  ids.agentRunId = routed.agentRunId;

  const [row] = await db
    .select({ active: suppressionEntries.active, reason: suppressionEntries.reason, source: suppressionEntries.source })
    .from(suppressionEntries)
    .where(eq(suppressionEntries.id, suppression.id))
    .limit(1);
  assert.deepEqual(row, { active: true, reason: "complaint", source: "resend" });

  const [event] = await db
    .select({ payload: eventLog.payloadJson })
    .from(eventLog)
    .where(sql`${eventLog.correlationId} = ${correlationId} and ${eventLog.eventType} = 'suppression_entry_created'`)
    .limit(1);
  assert.ok(event);
  assert.equal(event.payload.reactivated, true);
  assert.equal(event.payload.updatedReason, false);
  assert.equal(event.payload.source, "resend");
});

async function routeComplaintReply(
  db: ReturnType<typeof getDb>,
  email: string,
  correlationId: string
): Promise<{ inboundId: string; agentRunId: string }> {
  const [inbound] = await db
    .insert(inboundMessages)
    .values({ fromEmail: email, subject: "Re: Hello", rawText: "this is spam, stop emailing me" })
    .returning({ id: inboundMessages.id });
  assert.ok(inbound);

  const [agentRun] = await db
    .insert(agentRuns)
    .values({
      stage: "classify_reply",
      status: "succeeded",
      inputSnapshotJson: { inboundMessageId: inbound.id },
      outputJson: { class: "complaint" }
    })
    .returning({ id: agentRuns.id });
  assert.ok(agentRun);

  await routeClassifyReplyOutcome({
    agentRunId: agentRun.id,
    inboundMessageId: inbound.id,
    finalText: JSON.stringify({ class: "complaint", confidence: "high" }),
    correlationId
  });

  return { inboundId: inbound.id, agentRunId: agentRun.id };
}
