import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  closeDb,
  commands,
  eventLog,
  getDb,
  getOperationsCounters,
  invalidateOperationsCountersCache,
  pauseAllSendsCommand,
  resumeAllSendsCommand,
  systemState
} from "../src";

after(async () => {
  invalidateOperationsCountersCache();
  await closeDb();
});

test("getOperationsCounters caches one snapshot for 1 second and shares in-flight callers", async (t) => {
  await clearT023Artifacts();
  t.after(clearT023Artifacts);

  const [first, second] = await Promise.all([
    getOperationsCounters(),
    getOperationsCounters()
  ]);
  assert.equal(second, first);

  const cached = await getOperationsCounters();
  assert.equal(cached, first);
  assert.equal(cached.generatedAt.getTime(), first.generatedAt.getTime());

  await sleep(1_050);
  const fresh = await getOperationsCounters();
  assert.notEqual(fresh, first);
  assert.notEqual(fresh.generatedAt.getTime(), first.generatedAt.getTime());
});

test("pause and resume send-state changes invalidate cached operations counters", async (t) => {
  await clearT023Artifacts();
  t.after(clearT023Artifacts);

  const suffix = randomUUID();
  const initial = await getOperationsCounters();
  assert.equal(initial.sendsPause.paused, false);
  assert.equal(await getOperationsCounters(), initial);

  await pauseAllSendsCommand({
    payload: {
      reason: `T023 cache invalidation ${suffix}`,
      idempotencyKey: `pause_all_sends:t023:${suffix}`
    }
  });
  const paused = await getOperationsCounters();
  assert.notEqual(paused, initial);
  assert.equal(paused.sendsPause.paused, true);
  assert.equal(paused.sendsPause.reason, `T023 cache invalidation ${suffix}`);

  await resumeAllSendsCommand({
    payload: {
      idempotencyKey: `resume_all_sends:t023:${suffix}`
    }
  });
  const resumed = await getOperationsCounters();
  assert.notEqual(resumed, paused);
  assert.equal(resumed.sendsPause.paused, false);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clearT023Artifacts() {
  invalidateOperationsCountersCache();
  const db = getDb();
  const commandRows = await db
    .select({ id: commands.id })
    .from(commands)
    .where(sql`
      ${commands.idempotencyKey} like 'pause_all_sends:t023:%'
      or ${commands.idempotencyKey} like 'resume_all_sends:t023:%'
    `);
  const commandIds = commandRows.map((row) => row.id);

  if (commandIds.length > 0) {
    await db.delete(eventLog).where(inArray(eventLog.commandId, commandIds));
    await db.delete(commands).where(inArray(commands.id, commandIds));
  }
  await db.delete(systemState).where(eq(systemState.key, "sends_paused"));
  invalidateOperationsCountersCache();
}
