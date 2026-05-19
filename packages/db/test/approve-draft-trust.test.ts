import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test, type TestContext } from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  approveDraftForSendCommand,
  closeDb,
  commands,
  contacts,
  draftClaims,
  draftFeedback,
  drafts,
  eventLog,
  getDb,
  isSendsPaused,
  jobs,
  leaseNextJob,
  organizations,
  outboundMessages,
  pauseAllSendsCommand,
  processTelegramInboundUpdate,
  ragChunks,
  ragDocuments,
  ragEmbeddings,
  resumeAllSendsCommand,
  suppressionEntries,
  systemState,
  workItems
} from "../src";
import { POST as commandsPost } from "../../../apps/dashboard/app/api/commands/route";

after(async () => {
  await closeDb();
});

test("dashboard approve POST ignores forged send payload fields", async (t) => {
  const fixture = await insertApproveFixture(t, "dashboard");
  const previousFromEmail = process.env.RESEND_FROM_EMAIL;
  process.env.RESEND_FROM_EMAIL = "server-sender@example.com";
  t.after(() => {
    if (previousFromEmail === undefined) {
      delete process.env.RESEND_FROM_EMAIL;
    } else {
      process.env.RESEND_FROM_EMAIL = previousFromEmail;
    }
  });

  const form = new FormData();
  form.set("commandType", "approve_draft_for_send");
  form.set("draftId", fixture.draftId);
  form.set("draftVersion", "1");
  form.set("recipientEmail", "attacker@example.com");
  form.set("subject", "HACKED SUBJECT");
  form.set("body", "HACKED BODY");
  form.set("fromEmail", "attacker@example.com");
  form.set("contactId", randomUUID());
  form.set("campaignId", randomUUID());
  form.set("threadId", randomUUID());
  form.set("idempotencyKey", "approve_draft:attacker-controlled");

  const response = await commandsPost(new Request("http://localhost/api/commands", {
    method: "POST",
    body: form,
    headers: { referer: `http://localhost/drafts/${fixture.draftId}` }
  }));
  assert.equal(response.status, 303);

  const { snapshot, outbound } = await loadApprovedOutbound(fixture.draftId);
  assert.equal(outbound.recipientEmail, fixture.recipientEmail);
  assert.equal(snapshot["recipientEmail"], fixture.recipientEmail);
  assert.equal(snapshot["fromEmail"], "server-sender@example.com");
  assert.equal(snapshot["subject"], fixture.subject);
  assert.equal(snapshot["body"], fixture.body);
  assert.equal(snapshot["contactId"], fixture.contactId);
  assert.notEqual(snapshot["recipientEmail"], "attacker@example.com");
  assert.notEqual(snapshot["body"], "HACKED BODY");

  const db = getDb();
  const [command] = await db
    .select({ payloadJson: commands.payloadJson, idempotencyKey: commands.idempotencyKey })
    .from(commands)
    .where(eq(commands.targetEntityId, fixture.draftId))
    .limit(1);
  assert.ok(command);
  assert.deepEqual(command.payloadJson, { draftId: fixture.draftId, draftVersion: 1 });
  assert.notEqual(command.idempotencyKey, "approve_draft:attacker-controlled");
});

test("dashboard approve JSON rejects legacy send payload fields", async () => {
  const response = await commandsPost(new Request("http://localhost/api/commands", {
    method: "POST",
    body: JSON.stringify({
      commandType: "approve_draft_for_send",
      payload: {
        draftId: randomUUID(),
        draftVersion: 1,
        recipientEmail: "legacy@example.com",
        subject: "Legacy subject",
        body: "Legacy body",
        fromEmail: "legacy-sender@example.com",
        contactId: randomUUID(),
        campaignId: randomUUID(),
        threadId: randomUUID(),
        idempotencyKey: "approve_draft:legacy-controlled"
      }
    }),
    headers: { "content-type": "application/json" }
  }));

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error?.code, "validation_error");
  assert.match(JSON.stringify(body.error?.details), /recipientEmail/);
});

test("telegram approve uses server-resolved draft payload", async (t) => {
  const fixture = await insertApproveFixture(t, "telegram");
  const correlationId = randomUUID();
  const operatorId = randomUUID();
  const telegramUserId = 700_000 + Math.floor(Math.random() * 100_000);
  const updateId = 900_000 + Math.floor(Math.random() * 100_000);
  t.after(async () => {
    const db = getDb();
    await db.execute(sql`delete from ${eventLog} where correlation_id = ${correlationId}`);
    const notificationJobs = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.correlationId, correlationId));
    for (const job of notificationJobs) {
      await db.delete(eventLog).where(eq(eventLog.jobId, job.id));
    }
    await db.delete(jobs).where(eq(jobs.correlationId, correlationId));
  });

  const result = await processTelegramInboundUpdate({
    update: {
      updateId,
      message: {
        text: `/approve ${fixture.draftId} 1`,
        chat: { id: 123456 },
        from: { id: telegramUserId, username: "operator" }
      }
    },
    correlationId,
    operatorAllowlist: new Map([[telegramUserId, operatorId]]),
    defaultFromEmail: "telegram-sender@example.com"
  });
  assert.deepEqual(result, { kind: "acknowledged", command: "/approve" });

  const { snapshot, outbound } = await loadApprovedOutbound(fixture.draftId);
  assert.equal(outbound.recipientEmail, fixture.recipientEmail);
  assert.equal(snapshot["recipientEmail"], fixture.recipientEmail);
  assert.equal(snapshot["fromEmail"], "telegram-sender@example.com");
  assert.equal(snapshot["subject"], fixture.subject);
  assert.equal(snapshot["body"], fixture.body);
  assert.equal(snapshot["contactId"], fixture.contactId);
});

test("telegram approve with soft blockers prompts for confirm", async (t) => {
  const fixture = await insertApproveFixture(t, "telegram-soft");
  await insertSoftSuppression(t, fixture.recipientEmail);
  const correlationId = randomUUID();
  await cleanupTelegramCorrelationAfter(t, correlationId);
  const operatorId = randomUUID();
  const telegramUserId = 800_000 + Math.floor(Math.random() * 100_000);
  const updateId = 1_000_000 + Math.floor(Math.random() * 100_000);

  const result = await processTelegramInboundUpdate({
    update: {
      updateId,
      message: {
        text: `/approve ${fixture.draftId} 1`,
        chat: { id: 223344 },
        from: { id: telegramUserId, username: "operator" }
      }
    },
    correlationId,
    operatorAllowlist: new Map([[telegramUserId, operatorId]]),
    defaultFromEmail: "telegram-sender@example.com"
  });
  assert.deepEqual(result, {
    kind: "command_failed",
    command: "/approve",
    reason: "soft_blockers_pending_confirmation"
  });

  const texts = await loadTelegramNotificationTexts(correlationId);
  assert.ok(texts.some((text) =>
    text.includes("Soft blockers: active_suppression_soft") &&
    text.includes(`Reply with /confirm ${fixture.draftId} <reason>`)
  ));

  const db = getDb();
  const [event] = await db
    .select({ payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(sql`
      ${eventLog.correlationId} = ${correlationId}
      and ${eventLog.eventType} = 'telegram_command_failed'
      and ${eventLog.payloadJson}->>'reason' = 'soft_blockers_pending_confirmation'
    `)
    .limit(1);
  assert.ok(event);
  assert.equal(event.payloadJson["actorId"], operatorId);
  assert.deepEqual(event.payloadJson["softFailureCodes"], ["active_suppression_soft"]);
  assert.equal(event.payloadJson["requiresConfirm"], true);
});

test("telegram confirm applies soft-blocker override for the same actor", async (t) => {
  const fixture = await insertApproveFixture(t, "telegram-confirm");
  await insertSoftSuppression(t, fixture.recipientEmail);
  const approveCorrelationId = randomUUID();
  const rejectedCorrelationId = randomUUID();
  const confirmCorrelationId = randomUUID();
  await cleanupTelegramCorrelationAfter(t, approveCorrelationId);
  await cleanupTelegramCorrelationAfter(t, rejectedCorrelationId);
  await cleanupTelegramCorrelationAfter(t, confirmCorrelationId);
  const operatorId = randomUUID();
  const otherOperatorId = randomUUID();
  const telegramUserId = 850_000 + Math.floor(Math.random() * 100_000);
  const otherTelegramUserId = 950_000 + Math.floor(Math.random() * 100_000);
  const chatId = 334455;
  const approveUpdateId = 1_100_000 + Math.floor(Math.random() * 100_000);
  const otherConfirmUpdateId = approveUpdateId + 1;
  const confirmUpdateId = approveUpdateId + 2;

  const approve = await processTelegramInboundUpdate({
    update: {
      updateId: approveUpdateId,
      message: {
        text: `/approve ${fixture.draftId} 1`,
        chat: { id: chatId },
        from: { id: telegramUserId, username: "operator" }
      }
    },
    correlationId: approveCorrelationId,
    operatorAllowlist: new Map([[telegramUserId, operatorId], [otherTelegramUserId, otherOperatorId]]),
    defaultFromEmail: "telegram-sender@example.com"
  });
  assert.equal(approve.kind, "command_failed");

  const rejected = await processTelegramInboundUpdate({
    update: {
      updateId: otherConfirmUpdateId,
      message: {
        text: `/confirm ${fixture.draftId} Other operator reviewed the blocker and wants to send.`,
        chat: { id: chatId },
        from: { id: otherTelegramUserId, username: "other" }
      }
    },
    correlationId: rejectedCorrelationId,
    operatorAllowlist: new Map([[telegramUserId, operatorId], [otherTelegramUserId, otherOperatorId]]),
    defaultFromEmail: "telegram-sender@example.com"
  });
  assert.deepEqual(rejected, {
    kind: "command_failed",
    command: "/confirm",
    reason: "no_pending_confirmation"
  });

  const db = getDb();
  const outboundBeforeConfirm = await db
    .select({ id: outboundMessages.id })
    .from(outboundMessages)
    .where(eq(outboundMessages.draftId, fixture.draftId));
  assert.equal(outboundBeforeConfirm.length, 0);

  const confirmed = await processTelegramInboundUpdate({
    update: {
      updateId: confirmUpdateId,
      message: {
        text: `/confirm ${fixture.draftId} Same operator reviewed the soft blocker and approved this exception.`,
        chat: { id: chatId },
        from: { id: telegramUserId, username: "operator" }
      }
    },
    correlationId: confirmCorrelationId,
    operatorAllowlist: new Map([[telegramUserId, operatorId], [otherTelegramUserId, otherOperatorId]]),
    defaultFromEmail: "telegram-sender@example.com"
  });
  assert.deepEqual(confirmed, { kind: "acknowledged", command: "/confirm" });

  const { snapshot, outbound } = await loadApprovedOutbound(fixture.draftId);
  assert.equal(outbound.recipientEmail, fixture.recipientEmail);
  assert.equal(snapshot["fromEmail"], "telegram-sender@example.com");

  const [command] = await db
    .select({
      source: commands.source,
      actorId: commands.actorId,
      payloadJson: commands.payloadJson
    })
    .from(commands)
    .where(eq(commands.targetEntityId, fixture.draftId))
    .limit(1);
  assert.ok(command);
  assert.equal(command.source, "telegram");
  assert.equal(command.actorId, operatorId);
  assert.deepEqual(command.payloadJson["manualOverride"], {
    acknowledgedCodes: ["active_suppression_soft", "autosend_readiness_blocked_by_policy"],
    reason: "Same operator reviewed the soft blocker and approved this exception."
  });

  const [overrideEvent] = await db
    .select({ payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(sql`
      ${eventLog.eventType} = 'pre_send_override_applied'
      and ${eventLog.entityId} = ${fixture.draftId}
    `)
    .limit(1);
  assert.ok(overrideEvent);
  assert.deepEqual(overrideEvent.payloadJson["acknowledgedCodes"], [
    "active_suppression_soft",
    "autosend_readiness_blocked_by_policy"
  ]);
});

test("pause_all_sends emits non-overridable system_pause on approve", async (t) => {
  const fixture = await insertApproveFixture(t, "pause-block");
  await clearSendsPauseAfter(t);
  const reason = `T-004 incident ${randomUUID()}`;
  const pause = await pauseAllSendsCommand({ payload: { reason } });
  assert.equal(pause.state.paused, true);
  assert.equal((await isSendsPaused()).paused, true);

  const result = await approveDraftForSendCommand({
    payload: { draftId: fixture.draftId, draftVersion: 1 },
    fromEmail: "server-sender@example.com"
  });
  if (result.ok) assert.fail("approve should fail while sends are paused");
  assert.equal(result.failure.code, "system_pause");

  const db = getDb();
  const [event] = await db
    .select({ payloadJson: eventLog.payloadJson })
    .from(eventLog)
    .where(sql`${eventLog.eventType} = 'pre_send_guardrails_failed' and ${eventLog.entityId} = ${fixture.draftId}`)
    .orderBy(sql`${eventLog.createdAt} desc`)
    .limit(1);
  assert.ok(event);
  assert.deepEqual(event.payloadJson["failureCodes"], ["system_pause"]);
});

test("resume_all_sends clears pause and approve succeeds", async (t) => {
  const fixture = await insertApproveFixture(t, "pause-resume");
  await clearSendsPauseAfter(t);
  await pauseAllSendsCommand({ payload: { reason: `T-004 resume ${randomUUID()}` } });
  const resume = await resumeAllSendsCommand({ payload: {} });
  assert.equal(resume.state.paused, false);
  assert.equal((await isSendsPaused()).paused, false);

  const result = await approveDraftForSendCommand({
    payload: { draftId: fixture.draftId, draftVersion: 1 },
    fromEmail: "server-sender@example.com"
  });
  if (!result.ok) assert.fail(`approve should succeed after resume: ${result.failure.code}`);
});

test("queued send_email jobs do not lease while sends are paused", async (t) => {
  await clearSendsPauseAfter(t);
  const db = getDb();
  const jobId = randomUUID();
  const correlationId = randomUUID();
  t.after(async () => {
    await db.delete(eventLog).where(eq(eventLog.jobId, jobId));
    await db.delete(jobs).where(eq(jobs.id, jobId));
  });

  await db.insert(jobs).values({
    id: jobId,
    jobType: "job.send_email",
    status: "queued",
    workerPool: "t-004",
    targetEntityType: "outbound_message",
    targetEntityId: randomUUID(),
    payloadJson: { outboundMessageId: randomUUID() },
    correlationId
  });

  await pauseAllSendsCommand({ payload: { reason: `T-004 queued ${randomUUID()}` } });
  assert.equal(await leaseNextJob("t-004-paused-worker", 30, "t-004"), null);

  await resumeAllSendsCommand({ payload: {} });
  const leased = await leaseNextJob("t-004-resumed-worker", 30, "t-004");
  assert.equal(leased?.id, jobId);
});

test("dashboard command form accepts pause and resume send switch", async (t) => {
  await clearSendsPauseAfter(t);
  const pauseForm = new FormData();
  pauseForm.set("command_type", "pause_all_sends");
  pauseForm.set("reason", `T-004 route ${randomUUID()}`);

  const pauseResponse = await commandsPost(new Request("http://localhost/api/commands", {
    method: "POST",
    body: pauseForm,
    headers: { referer: "http://localhost/operations" }
  }));
  assert.equal(pauseResponse.status, 303);
  assert.equal((await isSendsPaused()).paused, true);

  const resumeForm = new FormData();
  resumeForm.set("command_type", "resume_all_sends");
  const resumeResponse = await commandsPost(new Request("http://localhost/api/commands", {
    method: "POST",
    body: resumeForm,
    headers: { referer: "http://localhost/operations" }
  }));
  assert.equal(resumeResponse.status, 303);
  assert.equal((await isSendsPaused()).paused, false);
});

async function insertSoftSuppression(t: TestContext, email: string) {
  const db = getDb();
  await db.insert(suppressionEntries).values({
    email,
    reason: "do_not_contact",
    source: "operator"
  });
  t.after(async () => {
    await db.delete(suppressionEntries).where(eq(suppressionEntries.email, email));
  });
}

async function cleanupTelegramCorrelationAfter(t: TestContext, correlationId: string) {
  const db = getDb();
  t.after(async () => {
    const notificationJobs = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.correlationId, correlationId));
    for (const job of notificationJobs) {
      await db.delete(eventLog).where(eq(eventLog.jobId, job.id));
    }
    await db.delete(eventLog).where(eq(eventLog.correlationId, correlationId));
    await db.delete(jobs).where(eq(jobs.correlationId, correlationId));
  });
}

async function loadTelegramNotificationTexts(correlationId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ payloadJson: jobs.payloadJson })
    .from(jobs)
    .where(sql`${jobs.correlationId} = ${correlationId} and ${jobs.jobType} = 'job.send_telegram_notification'`);
  return rows
    .map((row) => row.payloadJson["text"])
    .filter((text): text is string => typeof text === "string");
}

async function insertApproveFixture(
  t: TestContext,
  label: string
): Promise<{
  organizationId: string;
  contactId: string;
  draftId: string;
  recipientEmail: string;
  subject: string;
  body: string;
}> {
  const db = getDb();
  const recipientEmail = `t003-${label}-${randomUUID()}@example.com`;
  const subject = `T-003 ${label} original subject`;
  const body = `T-003 ${label} original body`;

  const [organization] = await db
    .insert(organizations)
    .values({ name: `T-003 ${label} org`, domain: `t003-${label}.example.com` })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const [contact] = await db
    .insert(contacts)
    .values({
      organizationId: organization.id,
      email: recipientEmail,
      fullName: `T-003 ${label}`
    })
    .returning({ id: contacts.id });
  assert.ok(contact);

  const [draft] = await db
    .insert(drafts)
    .values({
      contactId: contact.id,
      subject,
      body,
      claimsValidatedVersion: 1
    })
    .returning({ id: drafts.id });
  assert.ok(draft);

  await db.insert(draftClaims).values({
    draftId: draft.id,
    claimText: `T-003 ${label} supported claim`,
    safety: "supported"
  });

  t.after(async () => {
    const outboundRows = await db
      .select({ id: outboundMessages.id })
      .from(outboundMessages)
      .where(eq(outboundMessages.draftId, draft.id));
    for (const outbound of outboundRows) {
      const outboundJobs = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.targetEntityId, outbound.id));
      for (const job of outboundJobs) {
        await db.delete(eventLog).where(eq(eventLog.jobId, job.id));
      }
      await db.delete(eventLog).where(eq(eventLog.entityId, outbound.id));
      await db.delete(jobs).where(eq(jobs.targetEntityId, outbound.id));
      await db.delete(outboundMessages).where(eq(outboundMessages.id, outbound.id));
    }
    const blockerRows = await db
      .select({ id: workItems.id, dedupeKey: workItems.dedupeKey })
      .from(workItems)
      .where(eq(workItems.draftId, draft.id));
    for (const blocker of blockerRows) {
      const notificationJobs = await db.execute(sql<{ id: string }>`
        select id from ${jobs}
        where payload_json->>'entityId' = ${blocker.dedupeKey}
      `) as unknown as Array<{ id: string }>;
      for (const job of notificationJobs) {
        await db.delete(eventLog).where(eq(eventLog.jobId, job.id));
      }
      await db.execute(sql`
        delete from ${jobs}
        where payload_json->>'entityId' = ${blocker.dedupeKey}
      `);
    }
    await db.delete(workItems).where(eq(workItems.draftId, draft.id));
    await db.delete(eventLog).where(eq(eventLog.entityId, draft.id));
    await db.delete(draftFeedback).where(eq(draftFeedback.draftId, draft.id));
    await db.delete(commands).where(eq(commands.targetEntityId, draft.id));
    await db.delete(draftClaims).where(eq(draftClaims.draftId, draft.id));
    await db.delete(drafts).where(eq(drafts.id, draft.id));
    await db.delete(contacts).where(eq(contacts.id, contact.id));
    await db.execute(sql`
      delete from ${eventLog}
      where entity_id in (
        select id from ${ragDocuments}
        where organization_id = ${organization.id}
      )
    `);
    await db.execute(sql`
      delete from ${eventLog}
      where job_id in (
        select id from ${jobs}
        where target_entity_type = 'rag_document'
          and target_entity_id in (
            select id from ${ragDocuments}
            where organization_id = ${organization.id}
          )
      )
    `);
    await db.execute(sql`
      delete from ${jobs}
      where target_entity_type = 'rag_document'
        and target_entity_id in (
          select id from ${ragDocuments}
          where organization_id = ${organization.id}
        )
    `);
    await db.execute(sql`
      delete from ${ragEmbeddings}
      where chunk_id in (
        select rc.id
        from ${ragChunks} rc
        join ${ragDocuments} rd on rd.id = rc.document_id
        where rd.organization_id = ${organization.id}
      )
    `);
    await db.execute(sql`
      delete from ${ragChunks}
      where document_id in (
        select id from ${ragDocuments}
        where organization_id = ${organization.id}
      )
    `);
    await db.delete(ragDocuments).where(eq(ragDocuments.organizationId, organization.id));
    await db.delete(organizations).where(eq(organizations.id, organization.id));
  });

  return {
    organizationId: organization.id,
    contactId: contact.id,
    draftId: draft.id,
    recipientEmail,
    subject,
    body
  };
}

async function clearSendsPauseAfter(t: TestContext) {
  const db = getDb();
  await db.delete(systemState).where(eq(systemState.key, "sends_paused"));
  t.after(async () => {
    await db.delete(eventLog).where(sql`${eventLog.entityType} = 'system_state'`);
    await db.delete(commands).where(sql`${commands.targetEntityType} = 'system_state'`);
    await db.delete(systemState).where(eq(systemState.key, "sends_paused"));
  });
}

async function loadApprovedOutbound(draftId: string): Promise<{
  outbound: { id: string; recipientEmail: string };
  snapshot: Record<string, unknown>;
}> {
  const db = getDb();
  const [outbound] = await db
    .select({
      id: outboundMessages.id,
      recipientEmail: outboundMessages.recipientEmail,
      payloadSnapshotJson: outboundMessages.payloadSnapshotJson
    })
    .from(outboundMessages)
    .where(eq(outboundMessages.draftId, draftId))
    .limit(1);
  assert.ok(outbound);
  return {
    outbound: { id: outbound.id, recipientEmail: outbound.recipientEmail },
    snapshot: outbound.payloadSnapshotJson
  };
}
