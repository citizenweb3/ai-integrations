# T-026BE — Campaign-progress Telegram notifications

**Date:** 2026-06-01
**Status:** Design accepted, ready for implementation
**Scope:** `packages/db` (worker-side notification emission). No schema
migration. No dashboard change.

## Problem

A cold campaign runs the whole discovery → research → contact pipeline
silently. Telegram only fires on P0/P1 inbound/reply events and failures
(decision #234: "Telegram does not mirror the whole Inbox"). For a cold
batch there is no signal at all telling the operator:

1. that the **first reachable contact** (with an email) now exists, so a
   draft can be generated and outreach can begin; and
2. that **discovery + preparation for the campaign has finished**, so the
   batch is fully assembled and ready for review.

Today the operator learns this only by watching the live activity strip on
`/campaigns` or by polling the dashboard. There is no push.

## Goal

Two once-per-campaign Telegram notifications, reusing the existing
outbound notification path (`enqueueTelegramNotificationJob` +
`telegram_notification:<key>` concurrency-key dedup). No new transport, no
new tables.

## Notifications

### A — first addressable contact

- **Meaning:** the first contact with an email has been created for the
  campaign — outreach can now begin.
- **Anchor:** `routeContactCandidatesIntoOrg` (repositories.ts ~10477),
  inside the existing per-org tx, right after the T-026AU auto-convert
  creates a `contacts` row with an email.
- **Condition:** the count of addressable contacts (email IS NOT NULL)
  across the campaign's organizations equals exactly 1.
- **Text:**
  ```
  📇 First contact ready
  campaign: <name>
  org: <org name>
  <email>
  Generate a draft to start outreach.
  ```
- **notificationKey:** `campaign_addressable_ready:<campaignId>` →
  once per campaign for its whole lifetime.
- **priority:** 85 (P1).

### B — expansion complete

- **Meaning:** discovery has stopped looking (cap/cooldown) AND every
  research/contact job for the campaign has drained. The batch is fully
  assembled.
- **Anchors (whichever finishes last):**
  1. discovery-cooldown start (~13836,
     `campaign_discovery_cooldown_started`) — discovery stopped.
  2. `routeContactDiscoveryOutcome` (~10558,
     `contact_discovery_completed`) — last contact job closed.
- **Condition:** discovery cooldown is active for the campaign AND no
  campaign-scoped job in `('job.refresh_research_snapshot',
  'job.discover_contacts','job.research_more')` is in
  `('queued','leased','running')` (excluding the current job id).
- **Text (addressable > 0):**
  ```
  ✅ Campaign ready
  campaign: <name>
  <N> addressable contacts
  Discovery finished. Time to review drafts.
  ```
- **Text (addressable == 0):**
  ```
  ✅ Campaign ready
  campaign: <name>
  0 addressable contacts
  No reachable contacts found — review discovery scope.
  ```
- **notificationKey:** `campaign_expansion_done:<campaignId>:v<discoveryScopeVersion>`
  → once per discovery wave (a resume/scope-edit bumps the scope version
  and re-arms the notification for the new wave).
- **priority:** 80 (P1).

## Data flow / mechanics

Campaign → organizations link (no `campaign_id` on `organizations`; it is
carried by `discovery_candidates`):

```
orgs(campaignId) =
  select matched_organization_id
  from discovery_candidates
  where campaign_id = $1 and matched_organization_id is not null
```

Addressable count:

```
select count(*) from contacts
where organization_id in orgs(campaignId) and email is not null
```

Pending campaign jobs (for B):

```
select count(*) from jobs
where target_entity_id in orgs(campaignId)
  and job_type in ('job.refresh_research_snapshot',
                   'job.discover_contacts','job.research_more')
  and status in ('queued','leased','running')
  and id <> <currentJobId>
```

## Edge cases

1. **Race on first addressable (A).** Two orgs auto-convert an email in
   parallel tx and both read `count==1`. The dedup key
   `campaign_addressable_ready:<campaignId>` guarantees exactly one job is
   enqueued — `telegramNotificationJobExists` + the `concurrency_key`
   unique guard drop the second. No extra campaign-level lock needed.
2. **Second discovery wave (resume / scope edit).** A new
   `discoveryScopeVersion` produces a fresh key for B
   (`...:v<version>`), so the "ready" ping re-arms for the new wave. A
   stays version-less (first contact is a once-ever event).
3. **Zero addressable.** Discovery found orgs but no emails. cooldown
   active, pending==0, addressable==0 → B still fires with the
   "No reachable contacts found" variant (actionable: review scope). A
   does not fire.
4. **cooldown starts while contact jobs still running.** The cooldown
   anchor sees pending>0 and skips; the catch-up fires from
   `routeContactDiscoveryOutcome` when the last contact job closes.
   One of the two anchors is always the last to run.

## Placement

New helpers in `repositories.ts` (near `enqueueTelegramNotificationJob`):

- `campaignOrgIdsSubquery(campaignId)` — sql fragment for the orgs of a
  campaign via `discovery_candidates`.
- `maybeNotifyFirstAddressable(tx, {campaignId, organizationId, email, correlationId})`
- `maybeNotifyExpansionComplete(tx, {campaignId, scopeVersion, currentJobId, correlationId})`

Call sites (all inside existing transactions):

| Site | Helper |
|---|---|
| `routeContactCandidatesIntoOrg` ~10477 | `maybeNotifyFirstAddressable` |
| `routeContactDiscoveryOutcome` ~10558 | `maybeNotifyExpansionComplete` |
| discovery-cooldown start ~13836 | `maybeNotifyExpansionComplete` |

`campaignId` resolution: sites 10477/10558 resolve it via
`discovery_candidates` by organizationId; the cooldown site already has
`input.campaignId`.

## Tests (`packages/db/test/`, node:test)

1. `campaign-addressable-notify.test.ts` — first email contact enqueues a
   job with key `campaign_addressable_ready:<cid>`; a second email contact
   does not (count>1 + dedup).
2. `campaign-expansion-notify.test.ts` — cooldown + pending==0 enqueues;
   cooldown + pending>0 does not; addressable==0 yields the
   "No reachable contacts" text; a second scope version re-arms and
   enqueues a fresh ping.

## Build impact

`packages/db` only. Worker image rebuild required (`docker compose build
worker worker-telegram`). Dashboard untouched — these paths live solely in
the worker.

## Alignment

- Decision #234 (Telegram = P0/P1 actionable, not full inbox mirror): both
  notifications are P1 actionable batch-state transitions, not a mirror of
  background progress.
- Builds on T-026AU (auto-approve addressable contacts) — notification A
  hooks the exact point where an addressable contact is created.
