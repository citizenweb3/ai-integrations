import assert from "node:assert/strict";
import { test } from "node:test";
import {
  researchAgingDays,
  researchFreshness,
  researchStaleDays
} from "../src/index";

const now = new Date("2026-06-08T12:00:00.000Z");
const daysAgo = (n: number): Date => new Date(now.getTime() - n * 86_400_000);

test("thresholds are 30 (aging) and 90 (stale) days", () => {
  assert.equal(researchAgingDays, 30);
  assert.equal(researchStaleDays, 90);
});

test("fresh tier below the aging threshold", () => {
  assert.deepEqual(researchFreshness(daysAgo(0), now), { ageDays: 0, tier: "fresh" });
  assert.deepEqual(researchFreshness(daysAgo(1), now), { ageDays: 1, tier: "fresh" });
  assert.deepEqual(researchFreshness(daysAgo(29), now), { ageDays: 29, tier: "fresh" });
});

test("aging tier on [30, 90) days", () => {
  assert.deepEqual(researchFreshness(daysAgo(30), now), { ageDays: 30, tier: "aging" });
  assert.deepEqual(researchFreshness(daysAgo(89), now), { ageDays: 89, tier: "aging" });
});

test("stale tier at or beyond 90 days", () => {
  assert.deepEqual(researchFreshness(daysAgo(90), now), { ageDays: 90, tier: "stale" });
  assert.deepEqual(researchFreshness(daysAgo(200), now), { ageDays: 200, tier: "stale" });
});

test("future timestamps (clock skew) clamp to 0 days / fresh", () => {
  assert.deepEqual(researchFreshness(new Date(now.getTime() + 5_000), now), { ageDays: 0, tier: "fresh" });
});

test("accepts an ISO-string createdAt (server-action serialization)", () => {
  assert.deepEqual(researchFreshness(daysAgo(95).toISOString(), now), { ageDays: 95, tier: "stale" });
});
