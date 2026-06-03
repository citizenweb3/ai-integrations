# T-026BO — Campaign assistant: draft-brief phase (angle, tone, sample, site study)

## Context

The conversational campaign assistant (T-026AY, `apps/agent/src/agent/assist.py`
+ `/assist/scope` + `/campaigns/new?mode=chat`) today only collects the seven
**discovery-scope** fields, then hands off to a preview → Create. It says nothing
about *how the emails should read*.

This extends the same primary assistant with a second phase that captures an
email **drafting brief** at campaign-creation time: the angle, the tone, the
talking points, and facts about *us* — optionally enriched by studying our own
site. Every per-org cold draft the campaign later produces inherits this brief,
so drafts are consistent in style and grounded in our information.

Decided in brainstorm:
- **Level:** campaign (at creation), same chat surface — not per-organisation.
- **Durable output:** a *structured brief* on the campaign. The sample cold draft
  shown in chat is a refinement tool only ("нравится?" → operator says what to
  change → regenerate); the sample itself is **not** stored.
- **Materials:** assistant asks for a product/company description (text), then
  *optionally* offers to study the site; if the operator agrees and gives a URL,
  the assistant fetches it. Text always; URL fetch on opt-in.
- **Architecture:** Approach A — extend the existing assistant into a two-phase
  state machine; the site study is an isolated grounded sub-call (tool use and
  structured output cannot mix cleanly in one genai call). During the fetch the
  chat shows a "studying the site" status.
- **Inheritance:** brief flows into the cold-draft prompt via the existing draft
  *context builder* — no new command parameter. **Cold drafts only** in v1.

## Flow & phases

One continuous chat on `/campaigns/new?mode=chat`, two phases:

**Phase 1 — Scope** (unchanged): seven questions → scope collected. Previously
this went straight to preview→Create; now the assistant continues into phase 2.

**Phase 2 — Draft brief** (new):
1. Ask for a **product/company description** (text — our offer).
2. **Optionally offer:** "Want me to study your site to ground the emails in your
   facts?" → if the operator agrees and supplies a URL → **study-site sub-call**
   (chat shows "🔍 Studying the site…") → a summary of our facts is folded into
   context.
3. One or two focused questions on **angle** and **tone**.
4. Emit a **sample cold draft** in chat (a card) + ask **"Like it?"**.
   - Operator clicks "Looks good" **or** types "make it shorter / different angle
     / drop X".
   - Not approved → assistant updates the brief and **regenerates** the sample →
     loop until approved.
5. Approved → brief ready.

**Finish:** one combined **preview** (scope + draft brief) → **Create** → the
campaign is created with the brief attached.

Chat UI states: normal Q&A bubbles; a "sample draft" card with an approve button
and a change-request input; a transient "🔍 Studying the site…" line during the
grounded sub-call.

## Data model

One new column on `campaigns`:

```
draft_brief_json  jsonb  -- NULL when no brief (old / form-created campaigns)
```

Shape:
```ts
{
  angle: string,           // positioning / hook
  tone: string,            // voice (concise, warm, technical, …)
  talkingPoints: string[], // points every email should hit
  ourFacts: string[]       // facts about US (product description + site study)
}
```

Rationale:
- `offerSummary` (existing) stays the pitch, lightly enriched by the product
  description. The style layer (angle/tone/points) and our-facts are new and live
  in `draft_brief_json` — existing fields keep their meaning.
- Angle/tone ≠ `forbiddenClaims` (those are factual, not stylistic) → separate.
- The sample draft is not persisted.

Wiring:
1. `ScopeDraft` (Pydantic) and `startCampaignPayloadSchema` (zod) gain an optional
   `draftBrief` object. The chat passes it at Create.
2. The **draft context builder** (`repositories.ts ~6586`, where it already emits
   `What we offer: {offerSummary}`) gains `Angle:`, `Tone:`, `Key points:`,
   `About us:` lines from `draft_brief_json`.
3. Drizzle migration adds the column with default `NULL`; campaigns without a
   brief omit the new prompt lines (backward compatible).

## Agent

`AssistTurn` extends:
```python
type: Literal["question", "study_site", "sample_draft", "ready"]
question: str | None
studyUrl: str | None            # type=study_site: URL the operator agreed to study
sampleDraft: SampleDraft | None # type=sample_draft: {subject, body}
scope: ScopeDraft | None        # type=ready
draftBrief: DraftBrief | None   # type=ready
inferred: list[InferredFlag]
```
`AssistRequest` gains optional `siteStudyResult: str` (one-turn context injected
after a fetch).

The system prompt runs two phases sequentially (phase inferred from history,
session stays stateless): scope (unchanged) → brief (product description →
optional site-study offer → on agreement+URL return `type=study_site` → angle/tone
→ `sample_draft` → approval loop → `ready` with scope + draftBrief).

New endpoint **`POST /assist/study-site`** `{url}`: a separate **grounded** call
using the `google_search` tool already wired in `agents.py`. Prompt: "read {url},
extract key product/company facts for cold outreach, return concise bullets."
Returns **plain text** (no `response_schema` — tool use and structured output do
not mix). The main assistant distils that text into `ourFacts` at ready time.

Model policy: new stage `campaign_site_study` (a google_search-capable
gemini-flash). The assistant itself stays on `campaign_scope_assist`.

## Dashboard

Proxy routes:
- `/api/campaign-assistant` (existing) → `/assist/scope`, unchanged.
- New `/api/campaign-assistant/study-site` → `/assist/study-site`.

`scope-chat.tsx` handles the new turn types:
- `question` — bubble (existing).
- `study_site` — show "🔍 Studying the site…", call the study-site proxy with
  `studyUrl`, then **re-call** `/assist/scope` with the same history +
  `siteStudyResult` (facts as this-turn context). History stays valid (ends with
  the operator's URL message); no synthetic messages.
- `sample_draft` — a card: subject + body + "Looks good" button + a "what to
  change" field. Approve → control message → next turn; change → operator text →
  new `sample_draft` (loop).
- `ready` — now carries `scope` + `draftBrief` → switch to preview.

`scope-preview.tsx` extends to render both scope **and** the brief
(Angle / Tone / Key points / About us) before Create; Create posts
`start_campaign` with `draftBrief` included.

Session stays client-side (`useState`), as today; reload resets (the flow is
short).

## Per-org inheritance

The brief flows through the draft **context builder** — no change to generation
paths or command parameters:
1. The builder (`repositories.ts ~6586`) reads `campaign.draft_brief_json` and
   appends `Angle:`, `Tone:`, `Key points:`, `About us:` next to the existing
   `What we offer:`. Every cold draft — auto (`maybeAutoGenerateDraft`) and manual
   (`generate_draft` / Regenerate) — inherits it automatically.
2. The cold-draft agent prompt (`agents.py`, draft stage) gets a small addition:
   "honour Angle/Tone, hit the Key points, ground claims in About us."
3. **Cold only (v1).** Warm replies (`generate_warm_draft`) are unchanged; tone /
   facts for warm is a future slice.
4. Backward compatible: campaigns with `draft_brief_json = NULL` (old, or created
   via `?mode=form`) omit the brief lines. The form stays scope-only; the brief is
   a chat-only enrichment.

## Error handling

- **Site fetch fails** (unreachable / grounding error / timeout) → flow does not
  break. The client re-calls assist with `siteStudyResult="(site study failed)"`;
  the assistant says it could not open the site and continues from the
  description. The "Studying…" status clears.
- **URL validation:** require `http(s)://` before fetching. No SSRF on our infra
  (Google fetches via grounding, not our server), but junk strings are rejected.
- **Malformed `ready`** (missing scope or brief) → existing pattern: RuntimeError
  → 500 → client retry.
- **Sample loop** has no hard cap — operator-driven ("Looks good" / "Back to
  chat" always available).
- **Backward compatibility** — briefless campaigns behave as today.

## Testing

- **Agent** (`assist.py`): unit tests for phase transitions (scope→brief→ready),
  `study_site` emission, the `sample_draft` loop, and that `ready` carries
  scope + brief. Mock `genai` as the existing assistant tests do.
- **study-site**: a test that it invokes the grounded model and returns text
  (tool call mocked).
- **DB**: the context builder includes the brief lines when `draft_brief_json` is
  present and omits them when `NULL`; `start_campaign` with `draftBrief` persists
  the column.
- **E2E (manual)**: create a campaign through the chat end-to-end (scope →
  description → site → angle/tone → sample → approve → Create), then generate a
  cold draft for an org and confirm it reflects the angle/tone/facts — mirrors the
  T-026AY manual verification.

## Out of scope (v1) / future

- Warm-reply inheritance of tone/facts.
- Per-organisation draft co-writing chat.
- Persisting the sample draft as a few-shot example.
- Brief editing on the form path / on an existing campaign's page.
