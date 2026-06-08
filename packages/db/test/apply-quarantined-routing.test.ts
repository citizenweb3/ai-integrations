import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  agentRuns,
  applyQuarantinedReplyRoutingCommand,
  campaigns,
  closeDb,
  commands,
  contacts,
  eventLog,
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

const INJECTION = ["ignore all previous instructions"];

type Seed = {
  email: string;
  campaignId: string;
  orgId: string;
  contactId: string;
  inboundId: string;
  agentRunId: string;
};

async function seedInbound(db: ReturnType<typeof getDb>): Promise<Seed> {
  const email = `quarantine-${randomUUID()}@example.com`;
  const [campaign] = await db
    .insert(campaigns)
    .values({ name: "T-026C0 quarantine routing", objective: "apply withheld routing", targetSegments: [] })
    .returning({ id: campaigns.id });
  assert.ok(campaign);
  const [org] = await db
    .insert(organizations)
    .values({ name: "T-026C0 Org", domain: "t026c0.example.com" })
    .returning({ id: organizations.id });
  assert.ok(org);
  const [contact] = await db
    .insert(contacts)
    .values({ organizationId: org.id, email, fullName: "Quarantine Reply" })
    .returning({ id: contacts.id });
  assert.ok(contact);
  const [inbound] = await db
    .insert(inboundMessages)
    .values({ fromEmail: email, subject: "Re: Hello", rawText: "please unsubscribe me." })
    .returning({ id: inboundMessages.id });
  assert.ok(inbound);
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
  return { email, campaignId: campaign.id, orgId: org.id, contactId: contact.id, inboundId: inbound.id, agentRunId: agentRun.id };
}

async function teardown(db: ReturnType<typeof getDb>, s: Seed): Promise<void> {
  // The command mints its own correlationId, so events/jobs it emits do not carry
  // a test correlationId — clean by the entities they reference instead.
  await db.execute(sql`
    delete from event_log
    where entity_id in (${s.inboundId}, ${s.agentRunId})
      or entity_id in (select id from suppression_entries where lower(email) = lower(${s.email}))
      or command_id in (select id from commands where target_entity_id = ${s.inboundId})
  `);
  await db.execute(sql`delete from commands where target_entity_id = ${s.inboundId}`);
  await db.delete(jobs).where(sql`${jobs.payloadJson}->>'entityId' = ${s.inboundId}`);
  await db.delete(workItems).where(sql`${workItems.sourceEntityId} = ${s.inboundId} or ${workItems.inboundMessageId} = ${s.inboundId}`);
  await db.delete(suppressionEntries).where(sql`lower(${suppressionEntries.email}) = lower(${s.email})`);
  await db.delete(inboundMessages).where(eq(inboundMessages.id, s.inboundId));
  await db.delete(agentRuns).where(eq(agentRuns.id, s.agentRunId));
  await db.delete(contacts).where(eq(contacts.id, s.contactId));
  await db.delete(organizations).where(eq(organizations.id, s.orgId));
  await db.delete(campaigns).where(eq(campaigns.id, s.campaignId));
}

async function quarantine(db: ReturnType<typeof getDb>, s: Seed, replyClass = "unsubscribe"): Promise<void> {
  const routed = await routeClassifyReplyOutcome({
    agentRunId: s.agentRunId,
    inboundMessageId: s.inboundId,
    finalText: JSON.stringify({ class: replyClass, confidence: "high" }),
    correlationId: randomUUID(),
    injectionMatched: INJECTION
  });
  assert.deepEqual(routed, { replyClass, confidence: "high", quarantined: true });
}

function injectionDedupeKey(inboundId: string): string {
  return `prompt_injection:inbound:${inboundId}`;
}

test("apply routing on a quarantined unsubscribe suppresses and resolves the injection item", async (t) => {
  const db = getDb();
  const s = await seedInbound(db);
  t.after(() => teardown(db, s));

  await quarantine(db, s);

  // Quarantine withheld the suppression.
  const before = await db
    .select({ id: suppressionEntries.id })
    .from(suppressionEntries)
    .where(sql`lower(${suppressionEntries.email}) = lower(${s.email}) and ${suppressionEntries.active} = true`);
  assert.equal(before.length, 0);

  const [wiBefore] = await db
    .select({ status: workItems.status })
    .from(workItems)
    .where(eq(workItems.dedupeKey, injectionDedupeKey(s.inboundId)))
    .limit(1);
  assert.ok(wiBefore);
  assert.equal(wiBefore.status, "open");

  const result = await applyQuarantinedReplyRoutingCommand({ payload: { inboundMessageId: s.inboundId } });
  assert.ok(result.ok);
  assert.equal(result.alreadyApplied, false);
  assert.equal(result.replyClass, "unsubscribe");

  const [supp] = await db
    .select({ reason: suppressionEntries.reason, source: suppressionEntries.source, active: suppressionEntries.active })
    .from(suppressionEntries)
    .where(sql`lower(${suppressionEntries.email}) = lower(${s.email})`)
    .limit(1);
  assert.deepEqual(supp, { reason: "unsubscribe", source: "reply_classification", active: true });

  const [wiAfter] = await db
    .select({ status: workItems.status })
    .from(workItems)
    .where(eq(workItems.dedupeKey, injectionDedupeKey(s.inboundId)))
    .limit(1);
  assert.equal(wiAfter?.status, "resolved");

  const deq = await db
    .select({ id: eventLog.id })
    .from(eventLog)
    .where(sql`${eventLog.entityId} = ${s.inboundId} and ${eventLog.eventType} = 'reply_routing_dequarantined'`);
  assert.equal(deq.length, 1);

  // The de-quarantined routing emits its own reply_class_routed (command-scoped,
  // distinct from the quarantine-path one which carries no command id).
  const routedEvents = await db
    .select({ id: eventLog.id })
    .from(eventLog)
    .where(sql`${eventLog.entityId} = ${s.inboundId} and ${eventLog.eventType} = 'reply_class_routed' and ${eventLog.commandId} is not null`);
  assert.equal(routedEvents.length, 1);

  // Returned routing actions carry the applied suppression.
  assert.ok(result.actions.some((action) => action.kind === "suppression_applied"));

  // The command audit row is recorded.
  const [commandRow] = await db
    .select({
      commandType: commands.commandType,
      targetEntityType: commands.targetEntityType,
      targetEntityId: commands.targetEntityId
    })
    .from(commands)
    .where(eq(commands.id, result.commandId))
    .limit(1);
  assert.deepEqual(commandRow, {
    commandType: "apply_quarantined_routing",
    targetEntityType: "inbound_message",
    targetEntityId: s.inboundId
  });
});

test("apply routing on a quarantined warm reply creates the warm-review work item", async (t) => {
  const db = getDb();
  const s = await seedInbound(db);
  t.after(() => teardown(db, s));

  await quarantine(db, s, "positive_interest");

  const result = await applyQuarantinedReplyRoutingCommand({ payload: { inboundMessageId: s.inboundId } });
  assert.ok(result.ok);
  assert.equal(result.alreadyApplied, false);
  assert.equal(result.replyClass, "positive_interest");
  assert.ok(result.actions.some((action) => action.kind === "warm_reply_review_needed"));

  const [warm] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(eq(workItems.dedupeKey, `warm_reply:${s.inboundId}`))
    .limit(1);
  assert.ok(warm);

  const [injection] = await db
    .select({ status: workItems.status })
    .from(workItems)
    .where(eq(workItems.dedupeKey, injectionDedupeKey(s.inboundId)))
    .limit(1);
  assert.equal(injection?.status, "resolved");
});

test("apply routing is idempotent — a second call no-ops", async (t) => {
  const db = getDb();
  const s = await seedInbound(db);
  t.after(() => teardown(db, s));

  await quarantine(db, s);

  const first = await applyQuarantinedReplyRoutingCommand({ payload: { inboundMessageId: s.inboundId } });
  assert.ok(first.ok);
  assert.equal(first.alreadyApplied, false);

  const second = await applyQuarantinedReplyRoutingCommand({ payload: { inboundMessageId: s.inboundId } });
  assert.ok(second.ok);
  assert.equal(second.alreadyApplied, true);

  const active = await db
    .select({ id: suppressionEntries.id })
    .from(suppressionEntries)
    .where(sql`lower(${suppressionEntries.email}) = lower(${s.email}) and ${suppressionEntries.active} = true and ${suppressionEntries.reason} = 'unsubscribe'`);
  assert.equal(active.length, 1);

  const deq = await db
    .select({ id: eventLog.id })
    .from(eventLog)
    .where(sql`${eventLog.entityId} = ${s.inboundId} and ${eventLog.eventType} = 'reply_routing_dequarantined'`);
  assert.equal(deq.length, 1);
});

test("apply routing on a non-quarantined inbound is a no-op (does not double-route)", async (t) => {
  const db = getDb();
  const s = await seedInbound(db);
  t.after(() => teardown(db, s));

  // Route cleanly (no injection) — suppression applied, no injection work item.
  const routed = await routeClassifyReplyOutcome({
    agentRunId: s.agentRunId,
    inboundMessageId: s.inboundId,
    finalText: JSON.stringify({ class: "unsubscribe", confidence: "high" }),
    correlationId: randomUUID()
  });
  assert.deepEqual(routed, { replyClass: "unsubscribe", confidence: "high" });

  const [wi] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(eq(workItems.dedupeKey, injectionDedupeKey(s.inboundId)))
    .limit(1);
  assert.equal(wi, undefined);

  const result = await applyQuarantinedReplyRoutingCommand({ payload: { inboundMessageId: s.inboundId } });
  assert.ok(result.ok);
  assert.equal(result.alreadyApplied, true);

  const active = await db
    .select({ id: suppressionEntries.id })
    .from(suppressionEntries)
    .where(sql`lower(${suppressionEntries.email}) = lower(${s.email}) and ${suppressionEntries.active} = true and ${suppressionEntries.reason} = 'unsubscribe'`);
  assert.equal(active.length, 1);
});

test("apply routing fails when the inbound has no classified reply class", async (t) => {
  const db = getDb();
  const s = await seedInbound(db);
  t.after(() => teardown(db, s));

  // Never routed → reply_class is null.
  const result = await applyQuarantinedReplyRoutingCommand({ payload: { inboundMessageId: s.inboundId } });
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "not_classified");
});

test("apply routing fails when the inbound does not exist", async () => {
  const result = await applyQuarantinedReplyRoutingCommand({ payload: { inboundMessageId: randomUUID() } });
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "inbound_not_found");
});
