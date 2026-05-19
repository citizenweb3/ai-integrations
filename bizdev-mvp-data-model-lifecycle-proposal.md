# BizDev Outreach MVP: Data Model and Lifecycle Proposal

Source: [bizdev-outreach-pipeline-v2.md](/Users/user/project/dev/bizdev-email-agent/bizdev-outreach-pipeline-v2.md)

## Goal

Define the smallest model that supports the full MVP loop:
prospect discovery, research, draft generation, Telegram approval, outbound send, inbound reply capture, basic tracking, and operator-controlled continuation of the thread.

Design principle: avoid one overloaded `status` field. Keep current state in a few explicit axes and keep every important transition in an append-only event log.

## Minimal Entities

### 1. Organization
Represents the target company or project.

Key fields:

| Field | Why it exists |
| --- | --- |
| `id` | Internal identifier |
| `normalized_domain` | Primary dedupe key |
| `display_name` | Human-readable company/project name |
| `website_url` | Canonical site |
| `pillar` | `staking_growth` or `ai_workforce` |
| `description_short` | Current research summary used in prompting and review |
| `stage` | Minimal fit qualifier: `mainnet`, `testnet`, `prelaunch`, `unknown` |
| `tvl_band` | Keep coarse for MVP, avoid false precision |
| `research_confidence` | Current confidence score |
| `research_status` | See status axes |
| `outreach_status` | See status axes |
| `owner` | Usually Ivan / bot, for manual takeover |
| `first_seen_at`, `last_enriched_at`, `created_at`, `updated_at` | Operational timestamps |

Notes:
- Store only the latest usable company snapshot here.
- Raw findings and decisions belong in the event log, not as many nullable columns.

### 2. Contact
Represents a reachable person or shared mailbox at an organization.

Key fields:

| Field | Why it exists |
| --- | --- |
| `id` | Internal identifier |
| `organization_id` | Parent organization |
| `email_normalized` | Primary contact key |
| `display_name` | For personalization |
| `job_title` | Lightweight role context |
| `source` | `website`, `github`, `apollo`, `hunter`, `manual` |
| `confidence` | Confidence in identity/contact quality |
| `contact_status` | See status axes |
| `is_primary` | Preferred target when many emails exist |
| `last_contacted_at` | Guardrail for duplicate outreach |
| `created_at`, `updated_at` | Operational timestamps |

Constraints:
- Unique on `(organization_id, email_normalized)`.
- A contact can exist before it is approved for outreach.

### 3. Outreach
Represents one outbound initiative to one contact for one pillar.

Key fields:

| Field | Why it exists |
| --- | --- |
| `id` | Internal identifier |
| `organization_id` | Target company |
| `contact_id` | Target recipient |
| `pillar` | Frozen at outreach creation |
| `draft_subject` | Current editable subject |
| `draft_body` | Current editable body |
| `draft_model` | `sonnet` or `opus` |
| `draft_revision` | Monotonic revision counter |
| `personalization_level` | `personalized` or `generic` |
| `approval_status` | See status axes |
| `delivery_status` | See status axes |
| `engagement_status` | See status axes |
| `thread_status` | See status axes |
| `skip_reason` | Only set when skipped |
| `latest_outbound_message_id` | Link to sent email |
| `latest_inbound_message_id` | Link to latest reply |
| `created_at`, `approved_at`, `sent_at`, `closed_at`, `updated_at` | Lifecycle timestamps |

Constraints:
- MVP should allow only one active outreach per `(contact_id, pillar)`.
- Edits and redos update the same outreach record; history is preserved in the event log.

### 4. Message
Represents each actual email in a thread, inbound or outbound.

Key fields:

| Field | Why it exists |
| --- | --- |
| `id` | Internal identifier |
| `outreach_id` | Parent outreach/thread |
| `direction` | `outbound` or `inbound` |
| `provider_message_id` | Resend message id or inbound provider id |
| `provider_thread_key` | Stable grouping for replies if available |
| `in_reply_to_provider_message_id` | Thread linkage |
| `from_email`, `to_email` | Auditability |
| `subject` | Exact message subject |
| `body_text` | Stored body for review and reply drafting |
| `transport_status` | `accepted`, `sent`, `failed`, `received` |
| `opened_at` | First open timestamp if known |
| `clicked_at` | Optional, nullable |
| `received_at`, `created_at` | Operational timestamps |

Constraints:
- Unique on `provider_message_id` when present.
- All reply and tracking signals should resolve to a `Message`, then update the parent `Outreach`.

### 5. Event Log
Append-only business and integration history.

Key fields:

| Field | Why it exists |
| --- | --- |
| `id` | Internal identifier |
| `entity_type` | `organization`, `contact`, `outreach`, `message` |
| `entity_id` | Target entity |
| `event_type` | Business or integration event name |
| `event_source` | `system`, `telegram`, `resend_webhook`, `resend_poller`, `agent`, `manual` |
| `event_key` | Idempotency key, unique per source event |
| `payload_json` | Minimal raw payload or diff |
| `occurred_at` | When the event happened externally |
| `recorded_at` | When we persisted it |

Rule:
- This is the audit trail and replay source for debugging.
- Current state still lives on main tables for simple queries.

### 6. Idempotency Registry
Small operational table for commands and webhooks that must be processed once.

Key fields:

| Field | Why it exists |
| --- | --- |
| `scope` | `send_email`, `resend_inbound`, `resend_tracking`, `telegram_action` |
| `key` | Unique idempotency token |
| `status` | `processing`, `completed`, `failed` |
| `result_ref` | Created entity id or provider id |
| `expires_at` | Cleanup policy |
| `created_at`, `updated_at` | Operational timestamps |

Rule:
- `Event Log` tells the story.
- `Idempotency Registry` prevents duplicate side effects.

## Relationships

- One `Organization` has many `Contact`.
- One `Contact` can have many `Outreach` over time, but at most one active outreach per pillar in MVP.
- One `Outreach` has many `Message`.
- One `Organization`, `Contact`, `Outreach`, or `Message` can have many `Event Log` rows.

## Status Axes

### Organization: research axis

| Status | Meaning |
| --- | --- |
| `new` | Created from discovery, not researched yet |
| `researching` | Enrichment in progress |
| `researched` | Enough data for drafting |
| `insufficient_data` | Research completed but confidence below threshold |
| `archived` | Excluded from current pipeline |

### Contact: reachability axis

| Status | Meaning |
| --- | --- |
| `new` | Captured but not evaluated |
| `candidate` | Eligible for outreach |
| `do_not_contact` | Explicit suppression |
| `bounced` | Invalid or rejected by provider |
| `inactive` | Keep record, do not target now |

### Outreach: approval axis

| Status | Meaning |
| --- | --- |
| `pending_draft` | Outreach created, no usable draft yet |
| `draft_ready` | Draft generated by agent |
| `awaiting_review` | Sent to Telegram for decision |
| `needs_revision` | Ivan requested edit or redo |
| `approved` | Approved to send |
| `skipped` | Explicitly rejected |

### Outreach: delivery axis

| Status | Meaning |
| --- | --- |
| `not_sent` | Nothing sent yet |
| `queued` | Approved and waiting for transport |
| `sent` | Provider accepted outbound email |
| `send_failed` | Provider or local send failure |
| `delivered_unknown` | Sent, no stronger transport signal available |

### Outreach: engagement axis

| Status | Meaning |
| --- | --- |
| `none` | No engagement yet |
| `opened` | At least one open tracked |
| `replied` | Inbound reply received |
| `closed_won` | Positive outcome, handled manually outside MVP |
| `closed_lost` | Explicit no / no fit / stop |

### Outreach: thread ownership axis

| Status | Meaning |
| --- | --- |
| `no_thread` | No outbound message yet |
| `awaiting_prospect_reply` | Initial outbound sent |
| `reply_review_pending` | Inbound received, reply draft or manual decision pending |
| `manual_owner` | Ivan took over |
| `bot_reply_pending_send` | Reply approved, waiting to send |
| `done` | Thread complete for MVP purposes |

## Lifecycle

### 1. Discovery and dedupe
- Upsert `Organization` by normalized domain.
- Upsert discovered `Contact` rows.
- Write source evidence to `Event Log`.
- If organization already has active outreach for the same pillar, do not create a new one.

### 2. Research
- Enrich the organization from website, GitHub, Apollo, Hunter.
- Update latest company snapshot on `Organization`.
- If confidence is below threshold, set `research_status = insufficient_data`.
- Otherwise set `research_status = researched`.

### 3. Outreach creation and draft
- Create `Outreach` for one selected contact.
- Set `approval_status = pending_draft`.
- Generate first draft, save `draft_subject`, `draft_body`, `draft_model`, increment `draft_revision`.
- Move to `draft_ready`, then `awaiting_review`.

### 4. Telegram review loop
- `Approve`: set `approval_status = approved`, `delivery_status = queued`.
- `Edit` or `Redo`: set `approval_status = needs_revision`, update draft, return to `awaiting_review`.
- `Skip`: set `approval_status = skipped`, optionally set organization `outreach_status = archived`.
- `Send Generic`: keep same outreach, switch `personalization_level = generic`, then continue to approval/send.

### 5. Send
- Before external send, acquire idempotency key for the send operation.
- Create outbound `Message`.
- Send through Resend once.
- Persist provider ids on `Message`, update `Outreach.latest_outbound_message_id`.
- Set `delivery_status = sent`, `thread_status = awaiting_prospect_reply`.

### 6. Tracking
- Poll Resend for open and other transport signals.
- Resolve signal to `Message` by provider id.
- Update `Message` timestamps and parent `Outreach.engagement_status`.
- Tracking updates must be idempotent and monotonic: do not overwrite a stronger state with a weaker one.

### 7. Inbound reply
- Inbound webhook creates an inbound `Message` exactly once.
- Link it to the correct `Outreach` using provider ids and reply headers.
- Set `engagement_status = replied`, `thread_status = reply_review_pending`.
- Notify Telegram.

### 8. Reply handling
- MVP keeps human approval in the loop.
- If Ivan wants an agent-written reply, store it on the same `Outreach`, then send as a new outbound `Message`.
- If Ivan takes over, set `thread_status = manual_owner`.
- Close thread explicitly when no more agent action is expected.

## Event Types To Support From Day One

- `organization.discovered`
- `organization.researched`
- `organization.research_failed`
- `contact.discovered`
- `outreach.created`
- `outreach.draft_generated`
- `outreach.review_requested`
- `outreach.approved`
- `outreach.revision_requested`
- `outreach.skipped`
- `message.outbound_send_requested`
- `message.outbound_sent`
- `message.outbound_send_failed`
- `message.opened`
- `message.inbound_received`
- `thread.manual_takeover`
- `thread.closed`

## Idempotency Rules

- Discovery upsert:
  unique organization by normalized domain, unique contact by `(organization_id, email_normalized)`.
- Send command:
  one idempotency key per approved outreach revision. Retries must return the same outbound message, not create a second one.
- Resend inbound webhook:
  dedupe by provider event id if present, otherwise by stable hash of `(provider_message_id, received_at, from_email)`.
- Resend tracking polling:
  dedupe by `(provider_message_id, event_type, event_timestamp)`.
- Telegram actions:
  dedupe by `(chat_id, message_id, callback_data, actor_id)`.
- State transitions:
  reject impossible backward moves, for example `replied -> opened` as the final engagement status.

## What To Defer From MVP

- Separate `Batch` entity. The hourly batch can stay an execution concern, not a storage concern.
- Separate `EmailThread` entity. `Outreach + Message` is enough for MVP.
- Embeddings and vector search. Useful, but not required to validate the core operating loop.
- Fine-grained company profile tables for funding, tech stack, validator stats, and source-by-source snapshots.
- Auto-follow-up sequences and retry cadences.
- Multi-channel outreach.
- A/B testing and experiment entities.
- Webhook-only delivery tracking. Polling is sufficient first.
- Rich success pipeline and CRM-style opportunity stages.

## Recommended MVP Boundaries

- Keep one DB with six entities: `Organization`, `Contact`, `Outreach`, `Message`, `Event Log`, `Idempotency Registry`.
- Keep current state denormalized on the main entities for fast operator views.
- Keep all meaningful actions append-only in `Event Log`.
- Treat `Outreach` as the business aggregate and `Message` as transport/thread evidence.
- Do not introduce extra tables until one of these becomes painful: conflicting active outreach, replay/debugging gaps, or poor thread reconstruction.
