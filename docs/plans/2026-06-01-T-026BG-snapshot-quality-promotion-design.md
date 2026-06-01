# T-026BG — Promote research snapshot to `published` on quality-gate pass

**Date:** 2026-06-01
**Status:** Design accepted, ready for implementation
**Scope:** `packages/db` (worker-side promotion). UI surfacing is T-026BH.

## Problem

`research_snapshots.status` is dead weight. Every row is `draft`; nothing
ever writes `published` and nothing reads the column for a decision. The
research quality gate (`runResearchQualityGate`, an LLM agent) already runs
after every snapshot and computes a verdict (`sufficient: true/false`), but
that verdict is only used to enqueue a retry or recommend operator review —
it is never recorded on the snapshot itself.

## Goal (minimum — option 3a)

When the quality gate returns `sufficient: true`, promote the snapshot that
was just produced: `status = 'published'`. The column then reflects the
verdict the gate already computes. Drafting is NOT gated on `published` —
this is a status signal, not a new blocker (avoids the gate stalling the
pipeline). UI surfacing of the status is T-026BH.

## Mechanics

A new helper, called at both quality-gate sites
(`completeRefreshResearchSnapshotJob` ~12205,
`completeResearchMoreJob` ~14261):

```
async function promoteSnapshotOnQualityPass(input: {
  snapshotId: string;
  decision: ResearchQualityGateDecision | null;
  correlationId: string;
  jobId: string;
}): Promise<void>
```

- No-op when `decision` is null or `decision.sufficient !== true`.
- `UPDATE research_snapshots SET status='published', updated_at=now()
   WHERE id=snapshotId AND status <> 'published'` (idempotent — re-running a
  gate or a duplicate job does not re-emit).
- On a real transition (rowCount > 0) emit
  `research_snapshot_published` event {snapshotId, organizationId,
  confidence, sourceStage}.

The promotion runs after the gate returns, as its own statement — the
snapshot row is already committed (the gate is a separate network call after
the snapshot tx), so this is a follow-up update, consistent with how the
existing `research_quality_gate_review_recommended` event is appended
post-gate.

**Retry interaction:** promotion only fires on `sufficient: true`.
`sufficient: false` paths (retry enqueue / review recommended) never
promote. A retry that later passes promotes its own (newer) snapshot
version. Promotion is independent of `shouldEnqueueResearchQualityRetry`.

## Placement

Both call sites already have `qualityGateDecision`, `routerResult.snapshotId`,
`input.job.id`, `input.job.correlation_id` in scope. Insert the
`promoteSnapshotOnQualityPass` call right after the existing
`if (decision && !sufficient && !retry)` review block, before `completeJob`.

## Tests (`packages/db/test/`, node:test)

`research-snapshot-promotion.test.ts`:
1. `sufficient: true` → snapshot status becomes `published`, emits
   `research_snapshot_published`.
2. `sufficient: false` → status stays `draft`, no event.
3. null decision (no finalText) → status stays `draft`.
4. idempotent: calling twice on an already-`published` snapshot does not
   re-emit the event.

Tested directly against the helper with seeded snapshots (no live ADK).

## Build impact

`packages/db` only → rebuild worker + worker-telegram. No migration (column
exists). No dashboard change (T-026BH handles UI).

## Out of scope (deferred)

- Gating drafting on `published` (option 3b) — would change pipeline
  behavior; not now.
- UI badge / status display — T-026BH.
