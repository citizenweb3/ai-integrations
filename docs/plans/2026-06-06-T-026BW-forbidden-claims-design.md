# T-026BW — Enforce `forbiddenClaims` in drafting

**Status:** design, awaiting review
**Date:** 2026-06-06
**Author:** claude
**Basis:** post-launch hardening backlog item 2 (G6.3 — compliance) —
`docs/plans/2026-06-05-post-launch-hardening-backlog.md:32`

## Problem

A campaign can list `forbiddenClaims` — assertions the email must never make
(e.g. for a disinfectant campaign: "kills 100% of viruses", "cures COVID",
"absolutely safe"). They are collected (forms + scope-chat), stored
(`campaigns.forbidden_claims` `text[]`, `schema.ts:85`), surfaced in the
campaign view — but **never fed to any prompt and never checked against the
output**. A grep confirms `forbiddenClaims` reaches no prompt builder. The
guardrail silently does nothing: a draft can make a banned claim and it ships to
review unflagged.

## Decisions (operator, 2026-06-06)

1. **Prompt-side guard everywhere a draft is written:** cold draft, revise, AND
   the scope-chat sample (so the preview the operator approves matches how real
   drafts will behave).
2. **Post-generation verification = flag, not block** (matches every existing
   guardrail in this codebase; send is already approval-gated).
3. **Matching = case-insensitive substring** (cheap belt; the prompt is the real
   guard). Paraphrase evasion is an accepted limitation, smarter matching is a
   later enhancement.

No schema change — `forbidden_claims` already exists. No migration.

## Prompt injection — cold draft (`buildDraftPrompt`)

Mirror the T-026BV signature pattern:

- `DraftCampaignContext` (`repositories.ts:12630`): add `forbiddenClaims: string[]`.
- `completeGenerateDraftJob` campaign SELECT (`:16229`): add
  `forbiddenClaims: campaigns.forbiddenClaims`; map
  `forbiddenClaims: Array.isArray(campaign.forbiddenClaims) ? campaign.forbiddenClaims : []`
  into the context (`:16244`).
- `buildDraftPrompt` (`:15976`): render an operator-trusted block when non-empty,
  inside `if (input.campaignContext)`:

  ```
  Forbidden claims (operator-trusted — NEVER make any of these, even paraphrased):
  <forbidden_claims>
    - <claim, truncated 500>
    ...
  </forbidden_claims>
  ```

## Prompt injection — revise (`buildRevisePrompt`)

Revise rewrites a cold draft pre-send (the T-026BV/codex-F1 lesson: "make it
shorter" must not reintroduce a banned claim).

- `buildRevisePrompt` (`:16706`): add `forbiddenClaims: string[]` param + render
  the same `<forbidden_claims>` block (after `</operator_feedback>`).
- `completeReviseDraftJob` (`:16836`): add `forbiddenClaims` to the campaign
  SELECT (it already loads `senderSignature` there) and pass it into the call.

## Prompt injection — warm reply (`buildWarmDraftPrompt`) — codex F3

Warm replies are agent-written + approval-gated drafts too; leaving them
unguarded contradicts the "never make these claims" compliance invariant. The
thread carries the campaign (`threads.campaignId`, `schema.ts:188`), so the warm
path can load `forbiddenClaims` the same way:

- `completeGenerateWarmDraftJob` (`:13248`): load `forbiddenClaims` via the
  thread's campaign (`threads.campaignId → campaigns.forbidden_claims`) and pass
  it into `buildWarmDraftPrompt`.
- `buildWarmDraftPrompt` (`:16088`): render the same operator-trusted
  `<forbidden_claims>` block.
- `_DRAFT_WARM_INSTRUCTION` (`agents.py`): add the same FORBIDDEN CLAIMS rule
  (forbidden claims override the `replyIntent` and the snapshot).
- The warm builder already sanitizes untrusted tags via `sanitizePromptUntrusted`
  (it shares the reply_intent/thread_transcript/latest_inbound/fact set), so the
  `forbidden_claims` tag added there (below) covers warm too.

**Persist `campaignId` on warm drafts so AI-revise stays guarded (codex F4).**
Warm drafts are inserted with `threadId` but **no `campaignId`**
(`repositories.ts:13070-13082`), and AI-revise is exposed for warm drafts too
(`draft-modify-drawers.tsx`, `requestAiReviseCommand` not kind-restricted).
`completeReviseDraftJob` loads policy from `drafts.campaignId` (`:16835`), so a
guarded warm v1 would become an **unguarded warm v2** on revise. Fix:

- carry `threads.campaignId` into `routeWarmDraftEmailOutcome` and **set
  `campaignId` on the inserted warm draft row** (and on its event/work-item
  links). Null-campaign thread → null campaignId → no-policy (backward-compat).
- Then the existing `completeReviseDraftJob` campaign lookup preserves forbidden
  claims (and signature) for warm-revise with no extra special-casing.
- **Keep T-026BV's "warm replies are unsigned" decision:** now that warm drafts
  carry `campaignId`, `completeReviseDraftJob` would also start appending the
  signature on warm-revise. Gate the **signature** load to `kind !== "warm"`
  (add `kind` to the revise draft select) so only forbidden-claims (not the
  signature) is applied on the warm path — preserving the shipped behaviour.

**Existing warm drafts (legacy `drafts.campaignId = NULL`) — codex F6.**
Persisting `campaignId` on new warm inserts does not protect warm rows already in
the DB: they have `threadId` set but `drafts.campaignId = NULL`, even though their
thread is campaign-linked. On revise/manual-edit they would still resolve no
policy. So the content-write paths resolve the campaign with a **fallback**, not
the draft column alone:

```
resolvedCampaignId = draft.campaignId ?? (draft.threadId ? thread.campaignId : null)
```

- Apply this resolver in **both** content-write policy loads (`completeReviseDraftJob`
  and the manual-edit save path) — add `threadId` to their draft selects and look
  up `threads.campaignId` when the draft column is null. Covers legacy + future
  warm drafts uniformly; no data migration required.
- Signature stays gated on `kind === "warm"` **independently** of where the
  resolved campaignId came from (so a legacy warm draft resolved via the thread
  still gets forbidden-claims but no signature).
- A one-time backfill (`UPDATE drafts SET campaign_id = t.campaign_id FROM threads
  t WHERE drafts.thread_id = t.id AND drafts.campaign_id IS NULL`) is an optional
  later cleanup; the resolver makes it unnecessary for correctness.

## Agent instructions (`agents.py`)

- `_DRAFT_INSTRUCTION` (~`:121`, after the SIGNATURE rule): add a **FORBIDDEN
  CLAIMS** rule — "If a `<forbidden_claims>` block is present (operator-trusted),
  never make any of those claims or assertions, even in softened/paraphrased
  form. Forbidden claims take **absolute precedence** over the research snapshot
  AND the drafting brief's About-us facts — if a fact would require making a
  forbidden claim, omit it."
- `_REVISE_INSTRUCTION` (~`:224`): same rule, emphasising operator feedback
  cannot override it.
- `_DRAFT_WARM_INSTRUCTION`: same rule, emphasising the `replyIntent` cannot
  override it (codex F3 — warm now in scope).
- Add `<forbidden_claims>` to the operator-trusted-tag note in all three
  instructions so the model knows it is trusted, not data to ignore.

## Prompt-injection defence (sanitizers)

Add `forbidden_claims` to the delimiter-tag union in **both** sanitizers —
`sanitizePromptUntrusted` (`:16170`) and `sanitizeRevisePromptUntrusted`
(`:16770`) — so an injected `</forbidden_claims>` in an untrusted field (fact
text, contact name, reply body) cannot forge/break the block. The block itself
is operator-trusted and not sanitized.

## Scope-chat sample (`assist.py`)

The scope assistant already collects `forbiddenClaims` (`ScopeDraft`,
`_SYSTEM_INSTRUCTION` inferred list). Its **B6 sample_draft** step must be told
the example email must not contain any forbidden claim — so the preview the
operator approves is consistent with the real drafts. One rule added to the B6
sample wording in `_SYSTEM_INSTRUCTION`. No model/schema change.

## Post-generation verification (flag, not block)

A shared helper:

```ts
function scanForbiddenClaims(subject, body, forbiddenClaims): string[]
  // returns the forbidden claims found (case-insensitive substring in subject+body)
```

Wired into **all** draft routers — cold (`routeDraftEmailOutcome` `:12766`),
revise (`routeReviseDraftOutcome` `:16457`, from `completeReviseDraftJob` `:16962`),
and warm (`routeWarmDraftEmailOutcome` `:13005`, from `completeGenerateWarmDraftJob`
`:13248`) — plus the manual-edit save path. Each accepts `forbiddenClaims?: string[]`
(passed by its caller from the context / campaign SELECT / `threads.campaignId` —
no extra query). After the draft version is inserted, run the scan. On any hit,
inside the same tx:

- insert event `draft_email_forbidden_claim_hit` (via `tx.insert(eventLog)`).
  **Canonical payload (single source of truth, used everywhere — codex F5):**
  `{ draftId, draftVersion, organizationId, campaignId, matched: string[] }`.
  `campaignId` is the **resolved campaign** — the same `resolvedCampaignId =
  draft.campaignId ?? threads.campaignId` the policy load uses (codex F6/F7), NOT
  the raw draft column. This keeps the event/work-item correctly scoped even for
  legacy warm rows whose `drafts.campaign_id` is null (future inserts have it in
  the draft row directly). The scan, event, and work-item all receive this one
  resolved value from the content-write path.
- `createWorkItem(tx, { type: "draft_forbidden_claim_hit", priority: 75,
  sourceEntityType: "draft", sourceEntityId: draftId, title: "Forbidden claim in
  draft", summary: "<N> forbidden claim(s) detected: <matched…>", reasonCode:
  "forbidden_claim_detected", actionLabel: "Review draft", dedupeKey:
  "draft_forbidden_claim:{draftId}:v{version}", draftId, organizationId,
  campaignId })`. **`title` is required** by `createWorkItem` (`:18573`).
- The draft is **not** blocked — it still gets the normal `draft_review_pending`
  work item; the operator sees both.

**Dedupe per version (review):** the dedupeKey includes the draft **version**
(`…:v{version}`), not just `draftId`. Cold draft is v1; a later revise produces a
new version — version-scoping lets a revised version raise its own flag instead of
being silently swallowed by `onConflictDoNothing` on a draftId-only key.

`type` on `work_items` is free text (`schema.ts:549`), no enum/migration.
`priority: 75` sits between `draft_review_pending` (70) and `policy_blocker` (80).

### Version lifecycle (codex F1)

The flag must follow the draft-version lifecycle exactly as `draft_review_pending`
already does (`repositories.ts:16639-16669`: on a new version it resolves the prior
open review item and creates a fresh `draft_review:{draftId}:v{newVersion}`):

- **Supersede on content change:** whenever a new draft version is written
  (revise OR manual edit), resolve any prior open `draft_forbidden_claim_hit` for
  that draft, then re-scan the new version and (re)flag if it still hits. A clean
  v2 therefore clears a v1 warning; a v3 that reintroduces the phrase flags again.
- **Scan every content-write path, not just the agent routers:** the manual-edit
  save path also writes a new version (`recordDraftVersion` with
  `source: "operator_edited"`, `repositories.ts:8296-8303` — codex F5). It must run
  the same scan, else an operator can hand-type a forbidden phrase unflagged.
- **Resolve on approve/discard:** when a draft is approved-for-send or discarded,
  resolve any open `draft_forbidden_claim_hit` so a stale warning never outlives a
  sent/dropped draft.
- dedupeKey carries the version: `draft_forbidden_claim:{draftId}:v{version}`.
  The event uses the canonical versioned payload defined above (codex F5) — no
  second, stale payload shape anywhere.

### Inbox visibility (codex F2)

A work item that isn't registered only shows under the catch-all "All" tab with a
neutral fallback — the operator would miss it. Register the new type:

- **Routing** (`repositories.ts:~21498`): add `draft_forbidden_claim_hit` to the
  `approvals` bucket (alongside `draft_review_pending`) — it concerns a draft
  awaiting approval.
- **Presentation registry** (`apps/dashboard/lib/work-item-types.ts:~24-50`): add
  `draft_forbidden_claim_hit: { label: "Forbidden claim", glyph: "⛔", tone: "danger" }`.
- The work item's `title` + `summary` (the matched phrases) tell the operator what
  triggered it.

This pulls one dashboard file (`work-item-types.ts`) into scope beyond the
backlog's `packages/db` note — required for the flag to actually surface.

## Stages

- **M1 — prompt guard:** `DraftCampaignContext` + `generateDraftCommand`
  SELECT/map; `buildDraftPrompt` block; revise (`buildRevisePrompt` +
  `completeReviseDraftJob`); warm (`buildWarmDraftPrompt` +
  `completeGenerateWarmDraftJob`, via `threads.campaignId`);
  `_DRAFT_INSTRUCTION` + `_REVISE_INSTRUCTION` + `_DRAFT_WARM_INSTRUCTION` rules;
  both sanitizers; scope-chat sample rule. *Gate: every draft/revise/warm/sample
  prompt carries the forbidden list and the agent is told to obey.*
- **M2 — post-gen flag + lifecycle:** `scanForbiddenClaims` helper wired into the
  cold (`routeDraftEmailOutcome`) + revise (`routeReviseDraftOutcome`) + warm
  (`routeWarmDraftEmailOutcome`) + manual-edit content-write paths; version-scoped
  event + non-blocking work item; supersede the
  prior open flag on each new version; resolve on approve/discard; register the new
  type in the inbox routing + presentation registry. *Gate: a draft version that
  contains a forbidden phrase raises a visible (Approvals tab) flag; a clean
  revision clears it; approve/discard clears it.*

Backward-compatible: empty `forbidden_claims` (the default) → no block rendered,
no scan hits, behaviour unchanged.

## Risks / review focus

- **Substring evasion** — paraphrase ("ROI is guaranteed" vs "guaranteed ROI")
  slips the scan. Accepted; the prompt is the primary guard. Confirm acceptable.
- **Revise router** — resolved: revise output flows through `routeReviseDraftOutcome`
  (`:16457`); the shared helper hooks both it and `routeDraftEmailOutcome`.
  Version-scoped dedupeKey prevents double-flagging while still letting a revised
  version flag independently.
- **False positives** — a short forbidden phrase (e.g. "safe") could match
  innocuous text. Operator-authored list; flag-not-block keeps it low-risk.
  Consider word-boundary matching to reduce noise — review call.
- **Warm/reply drafts** — now IN scope (codex F3 + operator decision): warm
  replies get the prompt block + rule + post-gen scan, loading `forbiddenClaims`
  via `threads.campaignId`. Closes the compliance hole where a reply could make a
  banned claim. (Was originally backlog-scoped to cold only.)
- **draft_brief.ourFacts vs forbiddenClaims conflict** — if an operator lists a
  fact that contradicts a forbidden claim, the prompt now carries both; the
  instruction makes forbidden win (now stated as **absolute precedence** over
  snapshot + ourFacts).

## Workflow review (2026-06-06, 3 reviewers — addressed)

Most findings were "not implemented yet" (expected — design phase; they confirm
the M1/M2 touchpoint list). Genuine design refinements applied:

- **Revise router named.** The revise output routes through `routeReviseDraftOutcome`
  (`:16457`), a separate router from `routeDraftEmailOutcome` — the doc now names it
  as the second scan hook (event/work-item `campaignId` = the resolved campaign,
  not the raw draft column — see codex F7).
- **`createWorkItem` requires `title`.** The work-item spec now includes `title`
  (the helper's input type makes it required, `:18573`).
- **Version-scoped dedupeKey** (`draft_forbidden_claim:{draftId}:v{version}`) so a
  revised version can flag instead of being silently deduped on a draftId-only key.
- **Absolute precedence** of forbidden claims over snapshot facts + ourFacts baked
  into the instruction wording.
- Substring false-positives (short phrases) remain an accepted limitation;
  word-boundary matching is a documented later enhancement.

## Codex review (2026-06-06, addressed)

- **F1 [high] — version lifecycle.** Accepted. Flag now follows the draft-version
  lifecycle like `draft_review_pending` (`:16639-16669`): version-scoped key,
  supersede prior open flag on each new version, scan the manual-edit save path
  too, resolve on approve/discard.
- **F2 [medium] — inbox visibility.** Accepted. Register
  `draft_forbidden_claim_hit` in the approvals routing (`:~21498`) + presentation
  registry (`apps/dashboard/lib/work-item-types.ts`); required `title` + summary
  with matched phrases.
- **F3 [medium] — warm replies unguarded.** Accepted (operator chose to include
  warm). Warm path (`buildWarmDraftPrompt`, `_DRAFT_WARM_INSTRUCTION`,
  `routeWarmDraftEmailOutcome`, `completeGenerateWarmDraftJob`) now gets the block
  + rule + scan, loading `forbiddenClaims` via `threads.campaignId`. Closes the
  compliance hole.
- **F4 [high] — warm AI-revise loses campaign policy.** Accepted. Confirmed the
  warm draft insert (`:13070-13082`) omits `campaignId` and `completeReviseDraftJob`
  loads policy from `drafts.campaignId` (`:16835`) → a guarded warm v1 → unguarded
  warm v2. Fix: persist `threads.campaignId` on the warm draft row (+ event/work-item
  links); the existing revise lookup then preserves forbidden claims for warm-revise.
  Signature stays gated to `kind !== "warm"` to preserve T-026BV. Null campaign =
  no-policy backward-compat.
- **F5 [medium] — event spec contradiction + wrong source name.** Accepted. Event
  payload canonicalised in one place (`{draftId, draftVersion, organizationId,
  campaignId, matched}`); corrected the manual-edit source to `"operator_edited"`
  (`:8296-8303`), not `"manual_edit"`.
- **F6 [medium] — legacy warm drafts (campaignId NULL) still bypass.** Accepted.
  F4 only fixes future inserts; existing warm rows have `drafts.campaignId = NULL`
  on a campaign-linked thread. The content-write policy loads now resolve
  `draft.campaignId ?? threads.campaignId` (add `threadId` to their selects),
  covering legacy + future warm uniformly with no migration. Signature stays gated
  on `kind === "warm"` regardless of where the campaignId resolved from. Optional
  backfill noted as later cleanup.
- **F7 [medium] — event/work-item used the raw (null) draft column.** Accepted.
  The canonical event/work-item `campaignId` now uses the **same**
  `resolvedCampaignId` (`draft.campaignId ?? threads.campaignId`) the policy load
  uses — not the raw `drafts.campaign_id` — so a flagged legacy warm draft stays
  campaign-scoped instead of emitting an unscoped (null-campaign) event/work item.
  Removed the stale "campaignId comes from the draft row" statements.
