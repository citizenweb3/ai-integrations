import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, test, type TestContext } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  closeDb,
  eventLog,
  getDb,
  jobs,
  pruneWebhookEventNonces,
  webhookEventNonces,
  webhookEvents
} from "../src";
import { POST as resendDeliveryWebhookPost } from "../../../apps/dashboard/app/webhooks/resend/events/route";
import { POST as resendInboundWebhookPost } from "../../../apps/dashboard/app/webhooks/resend/inbound/route";

const deliverySecretBytes = Buffer.from("t-028-resend-delivery-secret");
const deliveryWebhookSecret = `whsec_${deliverySecretBytes.toString("base64")}`;
const inboundSecretBytes = Buffer.from("t-028-resend-inbound-secret");
const inboundWebhookSecret = `whsec_${inboundSecretBytes.toString("base64")}`;

after(async () => {
  await closeDb();
});

test("same svix-id replay short-circuits before webhook_events insert", async (t) => {
  const context = await withWebhookSecret(t);
  const svixId = `msg_${randomUUID()}`;
  const body = JSON.stringify({
    id: `evt_${randomUUID()}`,
    type: "email.delivered",
    data: { email_id: `email_${randomUUID()}`, to: "nonce-replay@example.com" }
  });

  const first = await resendDeliveryWebhookPost(signedRequest({
    svixId,
    body,
    secretBytes: deliverySecretBytes,
    path: "/webhooks/resend/events"
  }));
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.deduplicated, false);

  const second = await resendDeliveryWebhookPost(signedRequest({
    svixId,
    body,
    secretBytes: deliverySecretBytes,
    path: "/webhooks/resend/events"
  }));
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { deduplicated: true });

  const rows = await getDb()
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(eq(webhookEvents.providerEventId, JSON.parse(body).id));
  assert.equal(rows.length, 1);
  context.cleanupProviderEventIds.push(JSON.parse(body).id);
  context.cleanupSvixIds.push(svixId);
});

test("different svix-ids with same body still reach ingestion", async (t) => {
  const context = await withWebhookSecret(t);
  const body = JSON.stringify({
    id: `evt_${randomUUID()}`,
    type: "email.delivered",
    data: { email_id: `email_${randomUUID()}`, to: "nonce-distinct@example.com" }
  });
  const svixIdA = `msg_${randomUUID()}`;
  const svixIdB = `msg_${randomUUID()}`;

  const first = await resendDeliveryWebhookPost(signedRequest({
    svixId: svixIdA,
    body,
    secretBytes: deliverySecretBytes,
    path: "/webhooks/resend/events"
  }));
  assert.equal(first.status, 200);
  assert.equal((await first.json()).received, true);

  const second = await resendDeliveryWebhookPost(signedRequest({
    svixId: svixIdB,
    body,
    secretBytes: deliverySecretBytes,
    path: "/webhooks/resend/events"
  }));
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.received, true);
  assert.equal(secondBody.deduplicated, true);

  const nonces = await getDb()
    .select({ svixId: webhookEventNonces.svixId })
    .from(webhookEventNonces)
    .where(inArray(webhookEventNonces.svixId, [svixIdA, svixIdB]));
  assert.equal(nonces.length, 2);
  context.cleanupProviderEventIds.push(JSON.parse(body).id);
  context.cleanupSvixIds.push(svixIdA, svixIdB);
});

test("webhook nonce prune removes rows older than 24 hours", async (t) => {
  const db = getDb();
  const oldSvixId = `msg_${randomUUID()}`;
  const freshSvixId = `msg_${randomUUID()}`;
  t.after(async () => {
    await db.delete(webhookEventNonces).where(inArray(webhookEventNonces.svixId, [oldSvixId, freshSvixId]));
  });

  await db.insert(webhookEventNonces).values([
    { svixId: oldSvixId, seenAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    { svixId: freshSvixId, seenAt: new Date() }
  ]);

  const deleted = await pruneWebhookEventNonces();
  assert.equal(deleted, 1);

  const remaining = await db
    .select({ svixId: webhookEventNonces.svixId })
    .from(webhookEventNonces)
    .where(inArray(webhookEventNonces.svixId, [oldSvixId, freshSvixId]));
  assert.deepEqual(remaining.map((row) => row.svixId), [freshSvixId]);
});

test("delivery and inbound webhook routes use independent signing secrets", async (t) => {
  const context = await withWebhookSecret(t);
  const deliveryBody = JSON.stringify({
    id: `evt_${randomUUID()}`,
    type: "email.delivered",
    data: { email_id: `email_${randomUUID()}`, to: "delivery-secret@example.com" }
  });
  const inboundBody = JSON.stringify({
    id: `evt_${randomUUID()}`,
    type: "email.received",
    data: {
      email_id: `email_${randomUUID()}`,
      from: "reply@example.com",
      to: "inbound-secret@example.com",
      subject: "Re: hello",
      text: "Interested"
    }
  });
  const deliverySvixId = `msg_${randomUUID()}`;
  const inboundSvixId = `msg_${randomUUID()}`;

  const deliveryResult = await resendDeliveryWebhookPost(signedRequest({
    svixId: deliverySvixId,
    body: deliveryBody,
    secretBytes: deliverySecretBytes,
    path: "/webhooks/resend/events"
  }));
  assert.equal(deliveryResult.status, 200);
  assert.equal((await deliveryResult.json()).received, true);

  const inboundSignedForDelivery = await resendDeliveryWebhookPost(signedRequest({
    svixId: `msg_${randomUUID()}`,
    body: deliveryBody,
    secretBytes: inboundSecretBytes,
    path: "/webhooks/resend/events"
  }));
  assert.equal(inboundSignedForDelivery.status, 401);

  const deliverySignedForInbound = await resendInboundWebhookPost(signedRequest({
    svixId: `msg_${randomUUID()}`,
    body: inboundBody,
    secretBytes: deliverySecretBytes,
    path: "/webhooks/resend/inbound"
  }));
  assert.equal(deliverySignedForInbound.status, 401);

  const inboundResult = await resendInboundWebhookPost(signedRequest({
    svixId: inboundSvixId,
    body: inboundBody,
    secretBytes: inboundSecretBytes,
    path: "/webhooks/resend/inbound"
  }));
  assert.equal(inboundResult.status, 200);
  assert.equal((await inboundResult.json()).received, true);

  process.env.RESEND_WEBHOOK_SECRET_INBOUND = `whsec_${Buffer.from("rotated-inbound-secret").toString("base64")}`;
  const deliveryAfterInboundRotationBody = JSON.stringify({
    id: `evt_${randomUUID()}`,
    type: "email.delivered",
    data: { email_id: `email_${randomUUID()}`, to: "delivery-rotation@example.com" }
  });
  const deliveryAfterInboundRotationSvixId = `msg_${randomUUID()}`;
  const deliveryAfterInboundRotation = await resendDeliveryWebhookPost(signedRequest({
    svixId: deliveryAfterInboundRotationSvixId,
    body: deliveryAfterInboundRotationBody,
    secretBytes: deliverySecretBytes,
    path: "/webhooks/resend/events"
  }));
  assert.equal(deliveryAfterInboundRotation.status, 200);
  assert.equal((await deliveryAfterInboundRotation.json()).received, true);

  context.cleanupProviderEventIds.push(JSON.parse(deliveryBody).id);
  context.cleanupProviderEventIds.push(JSON.parse(inboundBody).id);
  context.cleanupProviderEventIds.push(JSON.parse(deliveryAfterInboundRotationBody).id);
  context.cleanupSvixIds.push(deliverySvixId, inboundSvixId, deliveryAfterInboundRotationSvixId);
});

function signedRequest(input: { svixId: string; body: string; secretBytes: Buffer; path: string }): Request {
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const signature = createHmac("sha256", input.secretBytes)
    .update(`${input.svixId}.${timestamp}.${input.body}`)
    .digest("base64");

  return new Request(`http://localhost${input.path}`, {
    method: "POST",
    body: input.body,
    headers: {
      "content-type": "application/json",
      "svix-id": input.svixId,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`
    }
  });
}

async function withWebhookSecret(t: TestContext) {
  const previousLegacySecret = process.env.RESEND_WEBHOOK_SECRET;
  const previousDeliverySecret = process.env.RESEND_WEBHOOK_SECRET_DELIVERY;
  const previousInboundSecret = process.env.RESEND_WEBHOOK_SECRET_INBOUND;
  delete process.env.RESEND_WEBHOOK_SECRET;
  process.env.RESEND_WEBHOOK_SECRET_DELIVERY = deliveryWebhookSecret;
  process.env.RESEND_WEBHOOK_SECRET_INBOUND = inboundWebhookSecret;
  const cleanupProviderEventIds: string[] = [];
  const cleanupSvixIds: string[] = [];
  t.after(async () => {
    if (previousLegacySecret === undefined) {
      delete process.env.RESEND_WEBHOOK_SECRET;
    } else {
      process.env.RESEND_WEBHOOK_SECRET = previousLegacySecret;
    }
    if (previousDeliverySecret === undefined) {
      delete process.env.RESEND_WEBHOOK_SECRET_DELIVERY;
    } else {
      process.env.RESEND_WEBHOOK_SECRET_DELIVERY = previousDeliverySecret;
    }
    if (previousInboundSecret === undefined) {
      delete process.env.RESEND_WEBHOOK_SECRET_INBOUND;
    } else {
      process.env.RESEND_WEBHOOK_SECRET_INBOUND = previousInboundSecret;
    }
    await cleanupWebhookRows(cleanupProviderEventIds, cleanupSvixIds);
  });

  return { cleanupProviderEventIds, cleanupSvixIds };
}

async function cleanupWebhookRows(providerEventIds: string[], svixIds: string[]) {
  const db = getDb();
  if (providerEventIds.length > 0) {
    const webhookRows = await db
      .select({ id: webhookEvents.id })
      .from(webhookEvents)
      .where(inArray(webhookEvents.providerEventId, providerEventIds));
    const webhookIds = webhookRows.map((row) => row.id);
    if (webhookIds.length > 0) {
      const jobRows = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(inArray(jobs.targetEntityId, webhookIds));
      const jobIds = jobRows.map((row) => row.id);
      if (jobIds.length > 0) {
        await db.delete(eventLog).where(inArray(eventLog.jobId, jobIds));
        await db.delete(jobs).where(inArray(jobs.id, jobIds));
      }
      await db.delete(eventLog).where(inArray(eventLog.entityId, webhookIds));
      await db.delete(webhookEvents).where(inArray(webhookEvents.id, webhookIds));
    }
  }
  if (svixIds.length > 0) {
    await db.delete(webhookEventNonces).where(inArray(webhookEventNonces.svixId, svixIds));
  }
}
