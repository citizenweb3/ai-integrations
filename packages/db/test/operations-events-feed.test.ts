import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { inArray } from "drizzle-orm";
import {
  closeDb,
  eventLog,
  getDb,
  getOperationsEventFeed,
  OPERATIONS_EVENT_FEED_LIMIT
} from "../src";

const TEST_CORRELATIONS = new Set<string>();

after(async () => {
  await clearOperationsEventArtifacts();
  await closeDb();
});

test("operations event feed filters by correlation id, event type, and time range", async (t) => {
  const db = getDb();
  const correlationA = randomUUID();
  const correlationB = randomUUID();
  TEST_CORRELATIONS.add(correlationA);
  TEST_CORRELATIONS.add(correlationB);
  await clearOperationsEventArtifacts();
  t.after(clearOperationsEventArtifacts);

  const base = Date.parse("2040-02-20T10:00:00.000Z");
  await db.insert(eventLog).values([
    {
      id: randomUUID(),
      eventType: "command_accepted",
      entityType: "command",
      entityId: randomUUID(),
      correlationId: correlationA,
      payloadJson: { marker: "t020", seq: 1 },
      createdAt: new Date(base)
    },
    {
      id: randomUUID(),
      eventType: "job_started",
      entityType: "job",
      entityId: randomUUID(),
      correlationId: correlationA,
      payloadJson: { marker: "t020", seq: 2 },
      createdAt: new Date(base + 60_000)
    },
    {
      id: randomUUID(),
      eventType: "job_started",
      entityType: "job",
      entityId: randomUUID(),
      correlationId: correlationB,
      payloadJson: { marker: "t020", seq: 3 },
      createdAt: new Date(base + 180_000)
    }
  ]);

  const byCorrelation = await getOperationsEventFeed({ correlationId: correlationA, limit: 10 });
  assert.equal(byCorrelation.filters.correlationId, correlationA);
  assert.equal(byCorrelation.filters.correlationIdValid, true);
  assert.deepEqual(byCorrelation.rows.map((row) => row.payloadJson["seq"]), [2, 1]);
  assert.ok(byCorrelation.rows.every((row) => row.correlationId === correlationA));

  const byTypeAndRange = await getOperationsEventFeed({
    eventType: "job_started",
    from: new Date(base + 30_000),
    to: new Date(base + 120_000),
    limit: 10
  });
  assert.deepEqual(byTypeAndRange.rows.map((row) => row.payloadJson["seq"]), [2]);

  const invalidCorrelation = await getOperationsEventFeed({ correlationId: "not-a-uuid", limit: 10 });
  assert.equal(invalidCorrelation.filters.correlationIdValid, false);
  assert.equal(invalidCorrelation.rows.length, 0);

  const capped = await getOperationsEventFeed({ correlationId: correlationA, limit: 9999 });
  assert.equal(capped.filters.limit, OPERATIONS_EVENT_FEED_LIMIT);
});

async function clearOperationsEventArtifacts() {
  if (TEST_CORRELATIONS.size === 0) return;
  const db = getDb();
  await db.delete(eventLog).where(inArray(eventLog.correlationId, [...TEST_CORRELATIONS]));
}
