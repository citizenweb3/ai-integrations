# T-026BV — Email sender signature: collect + use it

**Status:** design, awaiting review
**Date:** 2026-06-05
**Author:** claude
**Basis:** post-launch hardening backlog item 1 (was G8.4, re-scoped) —
`docs/plans/2026-06-05-post-launch-hardening-backlog.md:17`

## Problem

The drafting brief (`draftBriefSchema`: angle / tone / talkingPoints /
ourFacts — `packages/shared/src/index.ts:595`) carries no sender signature.
A grep across the source confirms there is **no notion of a sign-off / signature
anywhere** in the pipeline. So the cold-draft agent (`_DRAFT_INSTRUCTION`,
`apps/agent/src/agent/agents.py:74`) decides the closing on its own — it either
invents a sign-off or leaves a placeholder. Emails go out with an inconsistent
(or wrong) signature.

Decision (kept from the backlog): emails stay **plain text** (more personal,
better deliverability). The real gap is *capture* — so we collect a signature
and render it into the draft prompt to be used verbatim.

## Decisions (operator, 2026-06-05)

1. **Storage: a dedicated `campaigns.sender_signature` column** (not inside
   `draft_brief_json`).
2. **Shape: free text, used verbatim** (not structured name/title/company/link
   subfields).
3. **Collection: the scope-chat assistant is the primary surface**, plus the
   `/campaigns/new` form and the edit-scope form.

### Why a dedicated column, not `draft_brief_json.signature`

- `draft_brief_json` is written **only at creation** (`createStartCampaignCommand`,
  `packages/db/src/repositories.ts:608`) and is **never updated** by the
  edit-scope path. `updateCampaignScopeCommand` updates campaign **columns** one
  by one via a `hasOwn` guard pattern (`packages/db/src/repositories.ts:812-841`).
  Requirement (3) demands the signature be editable in the edit-scope form, so a
  column drops straight into that existing pattern; folding it into the brief
  blob would force a new partial-JSON-merge update path.
- Semantically distinct: the brief is the email's *persuasion* (angle/tone, set
  in chat); the signature is the sender's *identity* (set in chat **or** the
  form). Keeping `draftBriefSchema` narrow avoids confusing the Python
  `DraftBrief` model, which only knows the four brief fields.
- The read path is an explicit-column SELECT (`generateDraftCommand`,
  `packages/db/src/repositories.ts:16213`) with no zod re-parse — a plain
  `text` column needs no validation widening.

## Data model

One nullable column on `campaigns` (migration `0039`):

| column | type | meaning |
|---|---|---|
| `sender_signature` | `text` NULL | operator's verbatim email sign-off; NULL = none (pre-feature campaigns + scope-only creates), prompt omits the block |

Drizzle (`packages/db/src/schema.ts`, after `draftBriefJson:121`):
`senderSignature: text("sender_signature")`.

## Shared schemas (`packages/shared/src/index.ts`)

- `startCampaignPayloadSchema` (:603): add
  `senderSignature: z.string().trim().max(1000).optional()`.
- `updateCampaignScopePayloadSchema` (:655): add
  `senderSignature: z.string().trim().max(1000).nullable().optional()`
  (nullable so the operator can clear it — mirrors `offerSummary`/`operatorNotes`).

`max(1000)` fits a multi-line sign-off (name, title, company, contact + link).

## Persistence writes (`packages/db/src/repositories.ts`)

- **Normalize empty → NULL (review F2).** Persist a trimmed-empty / whitespace
  signature as `NULL`, not `""`, so the "NULL = none" invariant holds (zod
  `.trim().max(1000).optional()` accepts `""`, and a bare `?? null` would store
  the empty string). Normalize at both write sites:
  `senderSignature: (input.payload.senderSignature ?? "").trim() || null`.
- `createStartCampaignCommand` insert (:600-635): add the normalized
  `senderSignature`.
- `updateCampaignScopeCommand` set (:815): add
  `...(hasOwn(payload, "senderSignature") ? { senderSignature: (payload.senderSignature ?? "").trim() || null } : {})`.
  The edit form must POST the field via `nullableText(formData, "senderSignature")`
  so clearing it sends an explicit empty (→ NULL) rather than omitting the key.
- `getCampaignDiscoveryView` (the single-campaign read backing the edit form):
  add `senderSignature` to its column projection so the edit form can prefill it.

## Prompt rendering (`buildDraftPrompt`, `packages/db/src/repositories.ts:15970`)

- `DraftCampaignContext` type (:12626): add `senderSignature: string | null`.
- `generateDraftCommand` mapping (:16226): add
  `senderSignature: campaign.senderSignature ?? null`.
- In `buildDraftPrompt`, inside `if (input.campaignContext)`, after the
  `</drafting_brief>` block (:16030), render — only when non-empty
  (`const sig = input.campaignContext.senderSignature; if (sig && sig.trim())`,
  a defensive truthy guard so a stray `""` can never emit an empty block):

  ```
  Sender signature (operator-trusted — close the email with this EXACTLY):
  <signature>
  <verbatim signature text, truncated at 1000>
  </signature>
  ```

  Operator-trusted text, so it is emitted directly (not via the untrusted
  sanitizer), like the campaign context / drafting brief.

## Agent instruction (`_DRAFT_INSTRUCTION`, `apps/agent/src/agent/agents.py:110`)

Add a grounding rule near the `<drafting_brief>` rule:

> If a `<signature>` block is present (operator-trusted), end the email with that
> signature **exactly as written** — verbatim, no rewrites, no added/removed
> lines, **and do not translate it** (the LANGUAGE rule applies to the email
> body, not to the operator's signature). The ~60-120 word length budget covers
> the body, not the signature.

The explicit "do not translate" matters: `_DRAFT_INSTRUCTION` already tells the
agent to write the body in the recipient's language (English default) even when
the brief is in another language (`agents.py:115-120`); without the carve-out it
could translate a Russian operator's signature.

**Claims ↔ body (no extra validation).** The signature is appended to the
output `body` (that is what gets emailed). The agent's `claims` carry
`claimText` that must be a substring/paraphrase of `body` and trace to fact ids;
signature lines are not claims, so they appear in `body` with no entry in
`claims` and no `factIds`. `routeDraftEmailOutcome`'s fact-ownership check is
unaffected (it only validates claims that *are* emitted). No change to claims
handling is needed.

## Prompt-injection defence (sanitizers)

Add `signature` to the delimiter-tag union in **both** sanitizers —
`sanitizePromptUntrusted` (:16153) and `sanitizeRevisePromptUntrusted` (~:16739)
— so a `</signature>` planted in an *untrusted* field (contact name, fact text,
reply body) cannot break out of, or forge, the signature block. The signature
itself is operator-trusted and not run through the sanitizer.

## Revise path (review F1 — IN scope)

The AI-revise flow rewrites an **already-generated cold draft** (which already
ends with the signature) before send, so it can silently drop / reword /
translate the sign-off on "make it shorter". `buildRevisePrompt`
(`packages/db/src/repositories.ts:16689`) currently passes only the current
draft (untrusted), operator feedback (untrusted), and the snapshot — no campaign
context, no signature, no preserve rule. So the verbatim guarantee leaks at
revise. Bring it in scope:

- **`completeReviseDraftJob`** (`:16742`): the draft-row select currently fetches
  only `id/version/status/subject/body/contactId` — it must **add
  `drafts.campaignId`** (the column exists, nullable, `schema.ts:203 →
  references campaigns.id`). Then load `campaigns.sender_signature` for that
  campaign (null `campaignId` → no signature, same as the cold-draft
  null-context path) and pass it into `buildRevisePrompt`. The `buildRevisePrompt`
  input type gains `senderSignature: string | null`.
- **`buildRevisePrompt`** (`:16689`): render the same operator-trusted
  `<signature>` block (truthy-guarded, when present), after `</operator_feedback>`.
- **Revise agent instruction** — `_REVISE_INSTRUCTION`
  (`apps/agent/src/agent/agents.py:203`, wired as the `revise_email` stage via
  `_STAGE_SPEC:816`). **Not `_DRAFT_WARM_INSTRUCTION`** (`:148`) — that is the
  separate warm-reply agent (`draft_warm_email`); conflating the two was an error
  in an earlier draft of this doc (workflow review). `_REVISE_INSTRUCTION:216`
  already says "Preserve any structure the operator did not ask to change", but
  that is too weak for a sign-off. Add an explicit rule: preserve the
  `<signature>` block **exactly** — verbatim, do not translate, reword, or drop
  it, regardless of "shorter / punchier" feedback. The current draft body already
  carries the sign-off; the explicit block + rule stop the agent mangling it.
- `signature` is added to `sanitizeRevisePromptUntrusted` (see the sanitizer
  section) so an injected `</signature>` in the untrusted current-body cannot
  forge the block.

## scope-chat assistant (primary surface)

- **`apps/agent/src/agent/assist.py`**: add `senderSignature: str = ""` to the
  `ScopeDraft` Pydantic model (~:278). `_scrub_caps` untouched. The
  `_SYSTEM_INSTRUCTION` (:62) is prescriptive and hard-codes its question set, so
  every reference must be updated consistently (review F3) — a single "add a
  question" line is not enough:
  - **New required PHASE-2 step `B6. Signature`**: ask for the operator's email
    sign-off (name / title / company / contact link), captured verbatim into
    `scope.senderSignature`. PHASE 2 (B1–B6) is where "how the email reads /
    who signs" belongs; the signature is scope-level data but conversationally a
    drafting concern.
  - **Sample draft (B5)**: require the emitted `sample_draft` to **end with the
    operator's signature exactly**, so the operator approves the real closing,
    not a placeholder. (B6 may therefore precede B5, or B5 re-emits once the
    signature is known.)
  - **READY condition (:170-173)**: add `senderSignature` to the gate — do not
    emit `type="ready"` until the signature is captured.
  - **Reconcile the "seven required questions" wording (:117, :170, :185-192)**:
    that count is already loose (step `5a` adds a required recurrence question on
    top of the seven). Update the readiness checklist + rule 3 so the new
    required signature step is enforced and the prose count stays coherent.
- **`apps/dashboard/app/campaigns/new/scope-chat.tsx`**: add
  `senderSignature: string` to the `ScopeDraft` TS type (:18-33).
- **`apps/dashboard/app/campaigns/new/scope-preview.tsx`**: render a "Signature"
  row in the preview and a hidden `<input name="senderSignature" value=…>` so
  the chat result submits through the existing `start_campaign` form POST.
- **`apps/dashboard/app/api/campaign-assistant/route.ts`**: confirm it forwards
  the field (passthrough proxy); add it if the route reconstructs `ScopeDraft`.

## Forms

- **`apps/dashboard/app/campaigns/new/page.tsx`** (form mode): a `<Field>` +
  `<textarea name="senderSignature">` near `operatorNotes` (full-width).
- **`apps/dashboard/app/campaigns/[id]/scope/page.tsx`**: a `<ScopeLabel>` +
  `<textarea name="senderSignature" defaultValue={campaign.senderSignature ?? ""}>`.
- **`apps/dashboard/app/api/commands/route.ts`** `formDataToCommand`: parse
  `senderSignature` in both the `start_campaign` and `update_campaign_scope`
  branches (the chat-preview POST reuses the `start_campaign` branch).

## Migration & deploy

1. Migration `packages/db/drizzle/0039_campaign_sender_signature.sql`:
   `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sender_signature text;`
   Run `yarn db:migrate` (repo uses **yarn workspaces**, not pnpm).
2. Rebuild `@bizdev/db`; rebuild dashboard (forms + commands + chat), worker
   (`buildDraftPrompt`), and agent (`assist.py` + `agents.py`).

## Stages

- **M1 backend:** migration + `schema.ts` column; shared schemas (start +
  update); `createStartCampaignCommand` / `updateCampaignScopeCommand` /
  `getCampaignDiscoveryView` (with empty→NULL normalization); `DraftCampaignContext`
  + `generateDraftCommand` read; `buildDraftPrompt` `<signature>` block (truthy
  guard); **revise path** (`completeReviseDraftJob` loads signature via
  `campaignId`, `buildRevisePrompt` block, revise instruction preserve rule); both
  sanitizers; `_DRAFT_INSTRUCTION` verbatim rule. *Gate: a campaign created with a
  signature renders it verbatim in the cold-draft AND revise prompts; old
  campaigns (NULL) unchanged.*
- **M2 forms:** `/campaigns/new` + edit-scope textareas + `formDataToCommand`
  both branches. *Gate: operator can set on create and edit on a drafting_scope
  campaign, end-to-end.*
- **M3 scope-chat (main feature):** `assist.py` `ScopeDraft` + system prompt
  (new required `B6` step, sample-draft ends with the signature, READY gate +
  count reconciliation per F3); `scope-chat.tsx` type; `scope-preview.tsx` hidden
  input + preview; proxy passthrough. *Gate: the chat asks for and settles the
  signature, the sample draft shows it verbatim, and the preview submits it.*

Backward-compatible throughout: new column nullable, all schema fields
`.optional()`, prompt block rendered only when present.

## Risks / review focus

- **Edit window.** `updateCampaignScopeCommand` rejects edits unless
  `status==='drafting_scope'` (`repositories.ts:802`). So the signature — like
  all scope — is **not editable once the campaign is active**. A signature typo
  can't be fixed mid-campaign. Acceptable (matches existing scope semantics) or
  should the signature be editable on a live campaign?
- **Home of the signature.** A signature is arguably the *sender's* identity, and
  a `sender_identities` table + `campaigns.sender_identity_id` already exist. We
  chose campaign-level (per the backlog) so it can vary by campaign tone and to
  avoid a join/backfill. Is campaign-level the right model, or should it live on
  the sender identity (DRY across campaigns)?
- **Verbatim vs the LANGUAGE rule.** The "do not translate the signature"
  carve-out is the key correctness point — review whether the wording reliably
  stops the agent translating/reformatting a non-English signature.
- **Revise path now IN scope (F1).** `buildRevisePrompt` + `_REVISE_INSTRUCTION`
  get the signature + preserve rule (see the Revise section), because revise
  rewrites a cold draft pre-send. **Warm/reply drafts** (`_DRAFT_WARM_INSTRUCTION`,
  in-thread replies) remain out of scope per the backlog. Rationale (known
  limitation): a warm reply lands mid-thread, after the cold email that already
  carried the full sign-off; repeating name/title/company/link on every reply
  reads as noise, and the operator reviews warm drafts before send. Fold in later
  if a lightweight reply sign-off is wanted.
- **`max(1000)`** sufficient for any real sign-off? 
- **distill-brief-from-example** does not extract a signature from a pasted
  example email (signature comes from chat/form only). Acceptable?

## Codex review (2026-06-05, addressed in this revision)

- **F1 (High) — revise path breaks the "exactly" guarantee.** Confirmed:
  `buildRevisePrompt:16689` carries no signature/preserve rule, and revise runs
  on a cold draft pre-send. → Revise brought in scope (see "Revise path").
- **F2 (Medium) — `NULL = none` not guaranteed for an empty signature.**
  Confirmed: `?? null` keeps `""`. → Normalize `trim() || null` at both write
  sites + `nullableText` on the edit form + a truthy render guard.
- **F3 (Medium) — scope-chat readiness/sample not updated explicitly enough.**
  Confirmed: `_SYSTEM_INSTRUCTION` hard-codes the question set / READY gate. →
  New required `B6` step, sample draft must end with the verbatim signature,
  READY gate updated, "seven questions" wording reconciled.

## Workflow review (2026-06-05, 3 independent reviewers)

Verified the doc against the real code. Most findings were "not yet implemented"
(expected — this is the design phase; they confirm the M1–M3 touchpoint list is
accurate). Genuine design fixes applied:

- **Wrong revise constant (major).** The doc named `_DRAFT_WARM_INSTRUCTION` for
  the revise rule; the `revise_email` stage actually uses `_REVISE_INSTRUCTION`
  (`agents.py:203`, `_STAGE_SPEC:816`). Corrected in the Revise section.
  (Independently re-confirmed by codex.)
- **`drafts.campaignId` feasibility (verify).** Confirmed the column exists
  (`schema.ts:203`, nullable) so the revise path can load the signature; noted
  the `completeReviseDraftJob` select must add it (it currently does not).
- **Claims ↔ body (minor).** Documented that the signature lives in the output
  `body` and is not a claim — no claims-validation change.
- **Warm-draft rationale (minor).** Added the known-limitation rationale for
  leaving warm replies unsigned.
