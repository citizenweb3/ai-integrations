import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  closeDb,
  createInboxView,
  deleteInboxView,
  getDb,
  getInboxView,
  inboxViews,
  listInboxViews,
  updateInboxView,
  workItems
} from "../src";

const PAGINATION_TYPE = "t019_pagination";
const CRUD_TYPE = "t019_saved_view";
const OTHER_TYPE = "t019_other";

after(async () => {
  await closeDb();
});

test("getInboxView paginates with priority/createdAt/id cursor and keeps total count", async (t) => {
  const db = getDb();
  const operatorId = `t019-pagination-${randomUUID()}`;
  const dedupePrefix = `t019-pagination:${randomUUID()}`;
  t.after(async () => clearT019Artifacts(operatorId, dedupePrefix));
  await clearT019Artifacts(operatorId, dedupePrefix);

  const saved = await createInboxView({
    operatorId,
    name: "Pagination",
    filterJson: { types: [PAGINATION_TYPE] }
  });
  const base = new Date("2026-05-20T00:00:00.000Z");
  await db.insert(workItems).values(
    Array.from({ length: 205 }, (_, index) => ({
      type: PAGINATION_TYPE,
      status: "open",
      priority: 50,
      sourceEntityType: "test",
      sourceEntityId: randomUUID(),
      title: `Pagination item ${index}`,
      reasonCode: "t019",
      dedupeKey: `${dedupePrefix}:${index}`,
      createdAt: new Date(base.getTime() - index * 60_000),
      updatedAt: new Date(base.getTime() - index * 60_000)
    }))
  );

  const first = await getInboxView({
    savedViewId: saved.id,
    operatorId,
    tab: "all",
    limit: 200
  });
  assert.equal(first.totalCount, 205);
  assert.equal(first.items.length, 200);
  assert.ok(first.nextCursor);
  assert.equal(first.items[0]?.title, "Pagination item 0");
  assert.equal(first.items[199]?.title, "Pagination item 199");

  const second = await getInboxView({
    savedViewId: saved.id,
    operatorId,
    tab: "all",
    cursor: first.nextCursor,
    limit: 200
  });
  assert.equal(second.totalCount, 205);
  assert.equal(second.items.length, 5);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(second.items.map((item) => item.title), [
    "Pagination item 200",
    "Pagination item 201",
    "Pagination item 202",
    "Pagination item 203",
    "Pagination item 204"
  ]);
});

test("inbox saved views are CRUD-scoped by operator and filter work items", async (t) => {
  const db = getDb();
  const operatorId = `t019-operator-${randomUUID()}`;
  const otherOperatorId = `t019-other-${randomUUID()}`;
  const dedupePrefix = `t019-crud:${randomUUID()}`;
  t.after(async () => {
    await clearT019Artifacts(operatorId, dedupePrefix);
    await clearT019Artifacts(otherOperatorId, dedupePrefix);
  });
  await clearT019Artifacts(operatorId, dedupePrefix);
  await clearT019Artifacts(otherOperatorId, dedupePrefix);

  const saved = await createInboxView({
    operatorId,
    name: "High priority review",
    filterJson: { types: [CRUD_TYPE], priorityMin: 50 }
  });
  assert.equal((await listInboxViews(operatorId)).length, 1);
  assert.equal((await listInboxViews(otherOperatorId)).length, 0);

  await db.insert(workItems).values([
    workItemFixture(`${dedupePrefix}:match`, CRUD_TYPE, "open", 60, "Matching item"),
    workItemFixture(`${dedupePrefix}:low`, CRUD_TYPE, "open", 10, "Low priority item"),
    workItemFixture(`${dedupePrefix}:other`, OTHER_TYPE, "open", 90, "Other type item"),
    workItemFixture(`${dedupePrefix}:blocked`, CRUD_TYPE, "blocked", 40, "Blocked item")
  ]);

  const initial = await getInboxView({
    savedViewId: saved.id,
    operatorId,
    tab: "all"
  });
  assert.deepEqual(initial.items.map((item) => item.title), ["Matching item"]);

  const updated = await updateInboxView({
    id: saved.id,
    operatorId,
    name: "Blocked review",
    filterJson: { types: [CRUD_TYPE], statuses: ["blocked"] }
  });
  assert.ok(updated);
  assert.equal(updated.name, "Blocked review");

  const afterUpdate = await getInboxView({
    savedViewId: saved.id,
    operatorId,
    tab: "all"
  });
  assert.deepEqual(afterUpdate.items.map((item) => item.title), ["Blocked item"]);

  assert.deepEqual(await deleteInboxView({ id: saved.id, operatorId }), { deleted: true });
  assert.equal((await listInboxViews(operatorId)).length, 0);
});

function workItemFixture(
  dedupeKey: string,
  type: string,
  status: string,
  priority: number,
  title: string
) {
  return {
    type,
    status,
    priority,
    sourceEntityType: "test",
    sourceEntityId: randomUUID(),
    title,
    reasonCode: "t019",
    dedupeKey,
    createdAt: new Date("2026-05-20T00:00:00.000Z"),
    updatedAt: new Date("2026-05-20T00:00:00.000Z")
  };
}

async function clearT019Artifacts(operatorId: string, dedupePrefix: string) {
  const db = getDb();
  const views = await db
    .select({ id: inboxViews.id })
    .from(inboxViews)
    .where(eq(inboxViews.operatorId, operatorId));
  if (views.length > 0) {
    await db.delete(inboxViews).where(inArray(inboxViews.id, views.map((row) => row.id)));
  }
  await db.delete(workItems).where(sql`${workItems.dedupeKey} like ${`${dedupePrefix}:%`}`);
}
