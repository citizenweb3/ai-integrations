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
import { POST as resendWebhookPost } from "../../../apps/dashboard/app/webhooks/resend/events/route";

const secretBytes = Buffer.from("t-005-resend-webhook-secret");
const webhookSecret = `whsec_${secretBytes.toString("base64")}`;

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

  const first = await resendWebhookPost(signedRequest({ svixId, body }));
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.deduplicated, false);

  const second = await resendWebhookPost(signedRequest({ svixId, body }));
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

  const first = await resendWebhookPost(signedRequest({ svixId: svixIdA, body }));
  assert.equal(first.status, 200);
  assert.equal((await first.json()).received, true);

  const second = await resendWebhookPost(signedRequest({ svixId: svixIdB, body }));
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

function signedRequest(input: { svixId: string; body: string }): Request {
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const signature = createHmac("sha256", secretBytes)
    .update(`${input.svixId}.${timestamp}.${input.body}`)
    .digest("base64");

  return new Request("http://localhost/webhooks/resend/events", {
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
  const previousSecret = process.env.RESEND_WEBHOOK_SECRET;
  process.env.RESEND_WEBHOOK_SECRET = webhookSecret;
  const cleanupProviderEventIds: string[] = [];
  const cleanupSvixIds: string[] = [];
  t.after(async () => {
    if (previousSecret === undefined) {
      delete process.env.RESEND_WEBHOOK_SECRET;
    } else {
      process.env.RESEND_WEBHOOK_SECRET = previousSecret;
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
