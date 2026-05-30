# T-026AY — Conversational scope assistant for new campaigns

## Problem

Today `/campaigns/new` is a single 17-field form. The five required fields
(name, objective, offer summary, desired CTA, target segments) demand careful
free-form writing, and the optional twelve fields (source hints, exclusions,
allowed regions, caps, cooldowns, identity UUIDs, operator notes) overwhelm
operators who just want to spin up a campaign. There is no guided path for an
operator who has the idea in their head but no patience for a brief form.

## Goal

Give operators a second way to create a campaign: a short multi-turn chat with
an LLM that asks one question at a time, infers sensible defaults for the
optional fields, and produces a campaign scope they can review and submit.
The existing form stays as the power-user path.

## Non-goals

- Persistent chat history across sessions.
- Resuming an abandoned chat from another device.
- Replacing the form. Both paths coexist; either can be removed later.
- Multi-step agent tool calls (the assistant is a single LLM completion per
  turn, no web search, no DB lookups).

## Architecture

Two tabs on `/campaigns/new`, selected by `?mode=form|chat` in the URL. Form
remains the default so existing links keep working.

```
apps/dashboard/app/campaigns/new/page.tsx            # tab wrapper (server)
  ├── existing form               (mode=form, default)
  └── <ScopeChat /> client comp   (mode=chat)
        └── POST /api/campaign-assistant             # dashboard route
              └── POST ${AGENT_BASE_URL}/assist/scope  # FastAPI endpoint
                    └── google-genai chat completion with response_schema
```

Per turn, the client posts the full messages array to the dashboard route,
which forwards to the agent service with a Bearer token. The agent calls the
LLM once with a Pydantic-typed response schema and returns one of two shapes:
either a follow-up question, or a final scope plus a list of inferred fields.

## Agent contract

### Request

```python
class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str

class AssistRequest(BaseModel):
    messages: list[ChatMessage]
```

The first assistant message is hard-coded on the client and not sent back to
the server, so the array the agent sees starts with a `user` message.

### Response

```python
class ScopeDraft(BaseModel):
    name: str
    objective: str
    offerSummary: str
    desiredCta: str
    targetSegments: list[str]
    forbiddenClaims: list[str] = []
    operatorNotes: str = ""
    discoverySourceHints: list[str] = []
    discoveryExclusions: list[str] = []
    allowedRegions: list[str] = []
    maxOrganizationsToDiscover: int = 25
    cooldownBetweenDiscoverySeconds: int = 3600

class InferredFlag(BaseModel):
    field: str
    reason: str

class AssistTurn(BaseModel):
    type: Literal["question", "ready"]
    question: str | None = None
    scope: ScopeDraft | None = None
    inferred: list[InferredFlag] = []
```

Sender identity UUID and policy profile UUID are deliberately absent: the
assistant must not guess them. The operator picks them after the campaign is
created (or accepts the system defaults).

### Model

`gemini-3.5-flash` via the existing `resolve_model("campaign_scope_assist")`
helper. The stage is added to `_STAGE_MODEL_ENV_KEYS` so a deployment can
override with `AGENT_CAMPAIGN_SCOPE_ASSIST_MODEL` if the quality of the
inferred fields proves insufficient.

`temperature=0.4` — enough variability to suggest reasonable hints without
drifting into hallucinated lists.

### System prompt (sketch)

```
You are a campaign-scope assistant for a B2B outreach platform.
Goal: collect a complete campaign scope through one short question per turn
until you have enough to fill these required fields:
  name, objective, offerSummary, desiredCta, targetSegments.

Rules:
1. Ask exactly ONE question per turn. Keep it under two sentences.
2. Once the five required fields are unambiguous from the conversation,
   emit type="ready" with the full scope. Do not keep asking.
3. For optional fields (discoverySourceHints, discoveryExclusions,
   allowedRegions, forbiddenClaims, operatorNotes), infer sensible defaults
   from the objective and target segments. Record each inferred field in
   `inferred[]` with a one-line reason.
4. Never invent UUIDs (senderIdentityId, policyProfileId) and never set
   non-default values for the numeric caps — operators set those.
5. If the user replies with something contradictory or off-topic, gently
   steer back with one clarifying question.
```

## HTTP endpoints

### Agent service

`POST /assist/scope` in `apps/agent/src/agent/main.py`, mounted alongside the
existing `/runs/{stage}` route. Sync JSON response (not NDJSON). Auth reuses
`_authorize_agent_run` with the existing `AGENT_RUN_SECRET`. A hard cap of 40
messages per request keeps a misbehaving client from looping forever.

The handler delegates to `run_scope_assistant(messages)` in a new module
`apps/agent/src/agent/assist.py` that owns the prompt, the response schema,
and the google-genai call.

### Dashboard

`POST /api/campaign-assistant` in
`apps/dashboard/app/api/campaign-assistant/route.ts`. It is a thin proxy:
read JSON body, forward to `${AGENT_BASE_URL}/assist/scope` with the Bearer
token, return the agent response. On 4xx / 5xx from the agent it returns 502
with a truncated detail string. Network failures return 503.

## UI

### Tab wrapper (`page.tsx`)

Server component reads `searchParams.mode`. Renders the existing form when
`mode !== "chat"`, otherwise the `ScopeChat` client component. Above the
content sits a small two-link tab strip: "Form" and "Chat assistant", with
the active one styled like the discovery / contacts tabs on the campaign
detail page.

### `ScopeChat` (client)

State:

```ts
type Message = { role: "user" | "assistant"; content: string };
type AssistTurn =
  | { type: "question"; question: string }
  | { type: "ready"; scope: ScopeDraft; inferred: InferredFlag[] };

const [messages, setMessages] = useState<Message[]>([INITIAL_GREETING]);
const [input, setInput] = useState("");
const [busy, setBusy] = useState(false);
const [error, setError] = useState<string | null>(null);
const [finalTurn, setFinalTurn] = useState<AssistTurn | null>(null);
```

Layout: 88vw card matching T-026AX. Chat thread with `bg-white/5` bubbles
(user right, assistant left). Textarea + Send button below the thread while
`finalTurn === null`. The first message in `messages` is a hard-coded
greeting introducing the assistant and asking for the campaign goal.

Send flow:
1. Append the user message, clear input, set `busy=true`.
2. POST `/api/campaign-assistant` with the full `messages` array.
3. On success, either append `turn.question` as an assistant message or set
   `finalTurn` if `turn.type === "ready"`.
4. On error, set `error` and leave the user message in place so the user can
   retry without retyping.

Reset: a small "Start over" link in the corner clears state back to the
greeting.

### `ScopePreview` (client)

Rendered when `finalTurn !== null`. Card layout:

- Header: "Campaign scope ready"
- The five required fields, plain values.
- A separated block listing the inferred optional fields, each with the
  assistant's one-line reason and an "AI-suggested" badge.
- Buttons:
  - **Create campaign** — submits a hidden form to `/api/commands` with
    `commandType=start_campaign` and the scope fields as form data. Reuses
    the sync validation and redirect added in T-026AL, so a successful
    submit lands on `/campaigns/<id>` with discovery already kicked off.
  - **Edit fields** — toggles an inline editor (reuses `Field`, `inputClass`,
    `textareaClass`). Inferred fields keep their "AI-suggested" badge so
    operators see at a glance what to double-check.
  - **Back to chat** — clears `finalTurn`, appends an assistant message
    ("What would you like to adjust?"), and re-shows the input box. The
    conversation history is preserved, so the next turn includes the full
    context.

## Error handling

Two failure modes matter:

1. **Agent returns an invalid AssistTurn.** Pydantic raises, FastAPI returns
   422, the dashboard route surfaces 502, the client shows an inline error
   banner with a "Try again" button. The bad assistant turn is not appended
   to the messages array, so retrying re-sends the same conversation.
2. **start_campaign rejects the scope.** The existing route handler
   (T-026AL) validates synchronously and redirects to
   `/campaigns/new?error=...&mode=chat`. The chat UI re-mounts, the
   greeting is shown again, but a top-of-card banner explains the rejection
   so the operator can restart with the corrected information.

The assistant has no authority to bypass scope validation. If its output
fails validation, the operator must fix it (via the inline editor) or
restart the chat.

## Verification

Manual end-to-end via `webapp-testing` skill (Playwright MCP):

1. Open `/campaigns/new?mode=chat`. Confirm greeting renders.
2. Walk through a 4-6 turn conversation with a realistic prompt
   ("we sell devops consulting for crypto exchanges"). Confirm one question
   per turn, no batching.
3. On `ready` turn, confirm the preview card shows the five required fields
   and at least two inferred optional fields with reasons.
4. Click **Create campaign**. Confirm redirect to `/campaigns/<id>` and that
   discovery starts (stage strip shows "discovery running").
5. Repeat with **Edit fields** path: change the objective, submit, verify
   the campaign row reflects the edit.
6. Repeat with **Back to chat** path: ask to change the CTA, confirm the
   next turn understands the prior context.
7. Force a scope-validation failure (e.g., empty targetSegments via inline
   edit, then submit). Confirm error banner appears on reload and the chat
   UI re-greets.

DB check: pick the campaign created in step 4, confirm `discovery_source_hints`,
`discovery_exclusions`, `allowed_regions` are populated with the inferred
values and the numeric caps are the defaults.

## Implementation stages

- **A** — agent stage: `assist.py`, model policy entry, `/assist/scope`
  endpoint, smoke test against running agent container.
- **B** — dashboard proxy route + auth header passthrough.
- **C** — `page.tsx` tab wrapper.
- **D** — `ScopeChat` client component (chat only, no preview).
- **E** — `ScopePreview` client component + Create / Edit / Back wiring.
- **F** — manual verification via Playwright; fix anything that surfaces;
  clawmem pin + final commit.

Each stage is its own commit. The implementation plan
(`superpowers:writing-plans`) will turn this design into the per-stage
ticket list.
