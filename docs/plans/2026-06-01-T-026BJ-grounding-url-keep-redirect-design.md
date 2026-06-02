# T-026BJ — Keep Vertex grounding-redirect URLs as evidence sources

**Date:** 2026-06-01
**Status:** Design accepted, ready for implementation
**Scope:** `packages/db` research evidence normalization. Worker rebuild + db build.

## Problem

Auto-draft (T-026BI) did not fire for most orgs in a B2B campaign: 14
addressable contacts across 9 orgs, but only 3 snapshots reached `published`
and only 2 drafts generated. The research quality gate blocked the rest with
"all evidence source URLs are null, preventing verification".

Root cause is upstream of the gate. Vertex AI `google_search` returns sources
only as grounding-redirect URLs
(`https://vertexaisearch.cloud.google.com/grounding-api-redirect/...`). The
agent emits these as `sourceUrl`. The current code treats them as
throwaway trackers (`isGroundingTrackerUrl` -> drop to null), expecting a
"clean" primary URL to be recovered from Vertex grounding citation metadata
by quote→citation matching. That match only succeeds ~55% of the time
(339 of 613 evidence rows have a URL; 274 are null). When it fails, the fact
loses its source, the gate sees an unverifiable snapshot, and blocks it.

Verified the redirect is a real, working link: following the Bode redirect
resolves to `https://www.bode.bio/` (HTTP 200). Dropping it discards a valid
citation.

## Decision

Keep the grounding-redirect URL instead of nulling it. Per operator: the
~30-day redirect TTL is a non-issue — snapshots are refreshed well within
that window, and a stale redirect just prompts a re-research. A working
redirect beats a null source.

Raw URLs stay preferred when grounding metadata resolves them (prettier,
permanent); the redirect is the fallback so a fact never loses its citation.

## Changes (`repositories.ts`)

1. `normalizePrimaryResearchUrl` (~10079): today
   `if (isGroundingTrackerUrl) return null`. Change so a grounding-redirect
   URL is accepted and returned as-is (still trimmed, http(s)-only, hash
   stripped, length-capped). Non-grounding URLs normalize as before.
2. `normalizeEvidence` (~10316): consequence of (1) — its "tracker →
   citationUrl, else normalize" branch now keeps the redirect when no
   citation URL was recovered, instead of dropping to null. Prefer the
   citation (raw) URL when present; fall back to the redirect.
3. Update the `isGroundingTrackerUrl` doc comment: it is no longer "drop the
   tracker form" — it is "detect the redirect so we can prefer a recovered
   raw URL, and keep the redirect as a fallback". The detector stays useful.

Out of scope: `normalizeProposal` (~13591, discovery candidate sourceRefs).
That contour is anti-hallucination grounding for discovery, not gate/draft
evidence, and is left unchanged.

## Data

The 274 existing null-URL evidence rows are not backfillable — the raw
redirect was already discarded at write time. Those snapshots stay `draft`.
They self-heal on the next research run (refresh / research_more) under the
new code: fresh evidence keeps the redirect, passes the gate. Not a
migration.

## Verify

- Unit: `normalizeEvidence` — redirect with no citation → sourceUrl is the
  redirect (not null); redirect + resolvable citation → raw URL; clean URL →
  raw; junk → null.
- Live: on the current campaign, `refresh_research_snapshot` a stuck org
  (MSY / Bode) → new snapshot keeps evidence URLs → gate passes → snapshot
  published → auto-draft fires. End-to-end through the whole chain.

## Build

`packages/db` change → rebuild worker + worker-telegram, and
`yarn workspace @bizdev/db build` for the dashboard (it imports db from dist).
No migration.
