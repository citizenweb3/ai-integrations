import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  closeDb,
  deleteTelegramOperator,
  eventLog,
  getDb,
  invalidateTelegramOperatorAllowlistCache,
  jobs,
  listTelegramOperators,
  loadTelegramOperatorAllowlist,
  setTelegramOperatorActive,
  telegramOperators,
  upsertTelegramOperator
} from "../src";
import { POST as telegramWebhookPost } from "../../../apps/dashboard/app/webhooks/telegram/[secret]/route";

after(async () => {
  await closeDb();
});

test("telegram operator allowlist is DB-backed, cached, and invalidated by CRUD", async (t) => {
  const telegramId = 2_400_000_000 + Math.floor(Math.random() * 100_000);
  const operatorId = randomUUID();
  const ignoredEnvOperatorId = randomUUID();
  const previousEnv = process.env.TELEGRAM_OPERATOR_MAP;

  process.env.TELEGRAM_OPERATOR_MAP = JSON.stringify({ [telegramId]: ignoredEnvOperatorId });
  t.after(async () => {
    if (previousEnv === undefined) {
      delete process.env.TELEGRAM_OPERATOR_MAP;
    } else {
      process.env.TELEGRAM_OPERATOR_MAP = previousEnv;
    }
    invalidateTelegramOperatorAllowlistCache();
    await getDb().delete(telegramOperators).where(eq(telegramOperators.telegramId, telegramId));
  });

  invalidateTelegramOperatorAllowlistCache();
  await getDb().delete(telegramOperators).where(eq(telegramOperators.telegramId, telegramId));

  assert.equal((await loadTelegramOperatorAllowlist()).has(telegramId), false);

  const saved = await upsertTelegramOperator({ telegramId, operatorId });
  assert.equal(saved.telegramId, telegramId);
  assert.equal(saved.operatorId, operatorId);
  assert.equal(saved.active, true);

  const activeRows = await listTelegramOperators({ activeOnly: true });
  assert.ok(activeRows.some((row) => row.telegramId === telegramId && row.operatorId === operatorId));

  const firstLoad = await loadTelegramOperatorAllowlist();
  assert.equal(firstLoad.get(telegramId), operatorId);
  assert.notEqual(firstLoad.get(telegramId), ignoredEnvOperatorId);
  assert.equal(await loadTelegramOperatorAllowlist(), firstLoad);

  const disabled = await setTelegramOperatorActive({ telegramId, active: false });
  assert.equal(disabled?.active, false);
  assert.equal((await loadTelegramOperatorAllowlist()).has(telegramId), false);

  const inactiveRows = await listTelegramOperators();
  assert.ok(inactiveRows.some((row) => row.telegramId === telegramId && row.active === false));

  await upsertTelegramOperator({ telegramId, operatorId, active: true });
  assert.equal((await loadTelegramOperatorAllowlist()).get(telegramId), operatorId);

  assert.deepEqual(await deleteTelegramOperator(telegramId), { deleted: true });
  assert.equal((await loadTelegramOperatorAllowlist()).has(telegramId), false);
  assert.deepEqual(await deleteTelegramOperator(telegramId), { deleted: false });
});

test("telegram webhook loads operator allowlist from DB without TELEGRAM_OPERATOR_MAP", async (t) => {
  const telegramId = 2_500_000_000 + Math.floor(Math.random() * 100_000);
  const updateId = 3_500_000_000 + Math.floor(Math.random() * 100_000);
  const operatorId = randomUUID();
  const secret = `t024-${randomUUID()}`;
  const previousSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const previousMap = process.env.TELEGRAM_OPERATOR_MAP;

  process.env.TELEGRAM_WEBHOOK_SECRET = secret;
  delete process.env.TELEGRAM_OPERATOR_MAP;
  await upsertTelegramOperator({ telegramId, operatorId });
  t.after(async () => {
    if (previousSecret === undefined) {
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
    } else {
      process.env.TELEGRAM_WEBHOOK_SECRET = previousSecret;
    }
    if (previousMap === undefined) {
      delete process.env.TELEGRAM_OPERATOR_MAP;
    } else {
      process.env.TELEGRAM_OPERATOR_MAP = previousMap;
    }
    invalidateTelegramOperatorAllowlistCache();
    await deleteTelegramOperator(telegramId);
    await cleanupTelegramWebhookArtifacts(updateId);
  });

  const response = await telegramWebhookPost(
    new Request(`http://localhost/webhooks/telegram/${secret}`, {
      method: "POST",
      body: JSON.stringify({
        update_id: updateId,
        message: {
          text: `/confirm ${randomUUID()} short`,
          chat: { id: 123456 },
          from: { id: telegramId, username: "operator" }
        }
      }),
      headers: { "content-type": "application/json" }
    }),
    { params: Promise.resolve({ secret }) }
  );

  assert.equal(response.status, 200);
  const body = await response.json() as { result?: unknown };
  assert.deepEqual(body.result, {
    kind: "command_failed",
    command: "/confirm",
    reason: "invalid_arguments"
  });
});

async function cleanupTelegramWebhookArtifacts(updateId: number) {
  const db = getDb();
  const notificationJobs = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.concurrencyKey, `telegram_notification:telegram_inbound_reply:${updateId}`));

  for (const job of notificationJobs) {
    await db.delete(eventLog).where(eq(eventLog.jobId, job.id));
  }
  await db.delete(jobs).where(eq(jobs.concurrencyKey, `telegram_notification:telegram_inbound_reply:${updateId}`));
  await db.delete(eventLog).where(sql`${eventLog.payloadJson}->>'updateId' = ${String(updateId)}`);
}
