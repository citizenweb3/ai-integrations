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

test("reply-unsubscribe writes canonical hard suppression reason", async (t) => {
  const db = getDb();
  const correlationId = randomUUID();
  const email = `reply-unsubscribe-${randomUUID()}@example.com`;
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
      name: "T-001 unsubscribe test",
      objective: "Verify reply unsubscribe hard suppression",
      targetSegments: []
    })
    .returning({ id: campaigns.id });
  assert.ok(campaign);
  ids.campaignId = campaign.id;

  const [organization] = await db
    .insert(organizations)
    .values({ name: "T-001 Test Org", domain: "t001.example.com" })
    .returning({ id: organizations.id });
  assert.ok(organization);
  ids.organizationId = organization.id;

  const [contact] = await db
    .insert(contacts)
    .values({ organizationId: organization.id, email, fullName: "Reply Unsubscribe" })
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
      rawText: "Please unsubscribe me."
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
      outputJson: { class: "unsubscribe" }
    })
    .returning({ id: agentRuns.id });
  assert.ok(agentRun);
  ids.agentRunId = agentRun.id;

  const result = await routeClassifyReplyOutcome({
    agentRunId: agentRun.id,
    inboundMessageId: inbound.id,
    finalText: JSON.stringify({
      class: "unsubscribe",
      confidence: "high",
      reasoning: "Recipient explicitly asked to unsubscribe.",
      signals: ["please unsubscribe"]
    }),
    correlationId
  });
  assert.deepEqual(result, { replyClass: "unsubscribe", confidence: "high" });

  const [suppression] = await db
    .select({ reason: suppressionEntries.reason, source: suppressionEntries.source, active: suppressionEntries.active })
    .from(suppressionEntries)
    .where(eq(suppressionEntries.email, email))
    .limit(1);
  assert.deepEqual(suppression, {
    reason: "unsubscribe",
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
  assert.equal(suppressionFailure.metadata?.reason, "unsubscribe");
  assert.equal(suppressionFailure.metadata?.overridable, false);
  assert.ok((nonOverridableGuardrailCodes as readonly string[]).includes(suppressionFailure.code));
  assert.equal(guardrails.failures.some((failure) => failure.code === "active_suppression_soft"), false);
});

test("backfill handles active legacy/canonical suppression duplicates", async (t) => {
  const db = getDb();
  const email = `backfill-conflict-${randomUUID()}@example.com`;

  t.after(async () => {
    await db.delete(suppressionEntries).where(sql`lower(${suppressionEntries.email}) = ${email}`);
  });

  await db.insert(suppressionEntries).values([
    {
      email,
      reason: "unsubscribe",
      source: "reply_classification",
      active: true
    },
    {
      email: email.toUpperCase(),
      reason: "user_unsubscribe",
      source: "reply_classification",
      active: true
    }
  ]);

  await runUserUnsubscribeBackfill(db);

  const rows = await db
    .select({
      reason: suppressionEntries.reason,
      source: suppressionEntries.source,
      active: suppressionEntries.active
    })
    .from(suppressionEntries)
    .where(sql`lower(${suppressionEntries.email}) = ${email}`);

  assert.equal(rows.filter((row) => row.reason === "user_unsubscribe").length, 0);
  assert.equal(
    rows.filter((row) => row.reason === "unsubscribe" && row.source === "reply_classification" && row.active).length,
    1
  );
  assert.equal(
    rows.filter((row) => row.reason === "unsubscribe" && row.source === "reply_classification" && !row.active).length,
    1
  );
});

test("reply-unsubscribe routing merges active legacy duplicate into existing canonical row", async (t) => {
  const db = getDb();
  const correlationId = randomUUID();
  const email = `routing-conflict-${randomUUID()}@example.com`;
  const ids: { canonicalId?: string; legacyId?: string; inboundId?: string; agentRunId?: string } = {};

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

  const [canonical] = await db
    .insert(suppressionEntries)
    .values({
      email,
      reason: "unsubscribe",
      source: "reply_classification",
      active: true,
      updatedAt: new Date("2026-01-01T00:00:00.000Z")
    })
    .returning({ id: suppressionEntries.id });
  assert.ok(canonical);
  ids.canonicalId = canonical.id;

  const [legacy] = await db
    .insert(suppressionEntries)
    .values({
      email,
      reason: "user_unsubscribe",
      source: "reply_classification",
      active: true,
      updatedAt: new Date("2026-01-02T00:00:00.000Z")
    })
    .returning({ id: suppressionEntries.id });
  assert.ok(legacy);
  ids.legacyId = legacy.id;

  const [inbound] = await db
    .insert(inboundMessages)
    .values({
      fromEmail: email,
      subject: "Re: Hello",
      rawText: "unsubscribe"
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
      outputJson: { class: "unsubscribe" }
    })
    .returning({ id: agentRuns.id });
  assert.ok(agentRun);
  ids.agentRunId = agentRun.id;

  await routeClassifyReplyOutcome({
    agentRunId: agentRun.id,
    inboundMessageId: inbound.id,
    finalText: JSON.stringify({ class: "unsubscribe", confidence: "high" }),
    correlationId
  });

  const [canonicalAfter] = await db
    .select({ active: suppressionEntries.active, reason: suppressionEntries.reason })
    .from(suppressionEntries)
    .where(eq(suppressionEntries.id, canonical.id))
    .limit(1);
  assert.deepEqual(canonicalAfter, { active: true, reason: "unsubscribe" });

  const [legacyAfter] = await db
    .select({ active: suppressionEntries.active, reason: suppressionEntries.reason })
    .from(suppressionEntries)
    .where(eq(suppressionEntries.id, legacy.id))
    .limit(1);
  assert.deepEqual(legacyAfter, { active: false, reason: "user_unsubscribe" });
});

async function runUserUnsubscribeBackfill(db: ReturnType<typeof getDb>): Promise<void> {
  await db.execute(sql`
    UPDATE ${suppressionEntries} legacy
    SET active = false,
        updated_at = now()
    WHERE legacy.reason = 'user_unsubscribe'
      AND legacy.active = true
      AND EXISTS (
        SELECT 1
        FROM ${suppressionEntries} canonical
        WHERE canonical.active = true
          AND canonical.reason = 'unsubscribe'
          AND canonical.source = legacy.source
          AND lower(canonical.email) = lower(legacy.email)
          AND canonical.id <> legacy.id
      )
  `);
  await db.execute(sql`
    UPDATE ${suppressionEntries}
    SET reason = 'unsubscribe',
        updated_at = now()
    WHERE reason = 'user_unsubscribe'
  `);
}
