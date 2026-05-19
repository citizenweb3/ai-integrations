# BizDev Outreach MVP Canonical Design

**Date**: 2026-04-23  
**Status**: Canonical MVP design after review and decision log reconciliation  
**Supersedes**: [bizdev-outreach-pipeline-v2.md](/Users/user/project/dev/bizdev-email-agent/bizdev-outreach-pipeline-v2.md)

## 1. Goal

Build a local-first, operator-controlled outreach system for Citizen Web3 and ValidatorInfo that:

- discovers and enriches prospects
- runs campaign-level outreach missions
- drafts cold outreach emails
- captures replies on the same mailbox: `partner@citizenweb3.com`
- supports warm reply continuation in the same thread
- stores decision-grade history and feedback for future autosend learning

This MVP is **zero-autosend**. The system drafts, ranks, triages, and advises. The operator must explicitly approve every outbound send; after approval and guardrails, the worker performs the provider side effect.

## 2. Product Principles

- One visible mailbox for the full conversation lifecycle: `partner@citizenweb3.com`
- One campaign expresses top-level operator intent
- One active cold outreach thread per company at a time
- One primary contact per company for initial cold outreach
- Human approval required for every outbound send in MVP
- Structured state is the source of truth; RAG is only memory/retrieval
- Operator workflow is dashboard-first; Telegram is notification-first
- Continuous background processing, session-based operator review

## 3. Core Decisions

### Mail architecture

- Outbound provider: `Resend`
- Inbound provider: `Resend Inbound`
- Visible sender and reply identity: `partner@citizenweb3.com`
- Replies stay on the same mailbox identity
- No parallel Cloudflare Email Routing + Resend Inbound ownership on the same address in MVP
- Ivan is notified via Telegram, not via email forwarding

### Review and sending

- Dashboard is the primary review surface
- Telegram only sends urgent notifications and summary links
- Sending is operator-controlled
- No automatic cold send, warm send, follow-up send, or acknowledgment send in MVP

### Workflow model

- Background processing is continuous
- Review is session-based
- Urgent items notify immediately
- Non-urgent drafts and research items accumulate in Inbox
- Worker orchestration is event-driven and asynchronous
- Domain behavior is explicit via stage handlers, not via free-form autonomous agent negotiation

### Runtime model

- MVP runs locally through Docker Compose
- Services: `dashboard`, `worker`, `postgres`
- Dashboard and worker communicate through Postgres
- Dashboard sends operator commands through route handlers and shared services
- Worker executes jobs, ADK stages, external side effects, indexing, and background processing
- Persistent data lives in Postgres and configured volumes
- Secrets are loaded from local environment, not stored in repo or database artifacts

### Learning model

- Draft quality is learned from operator feedback, reply outcomes, and policy-safe signals
- Opens are stored but are only weak secondary signals
- RAG is a semantic memory layer over curated artifacts, not workflow truth
- MVP stores training-ready history for future autosend, but autosend itself is disabled

## 4. Scope

### In MVP

- Prospect discovery and enrichment
- Campaign creation and lifecycle
- Contact capture and ranking
- Cold draft generation
- Warm reply classification and drafting
- Dashboard review for cold and warm drafts
- Telegram notifications with deep links intended for Telegram Desktop on the same machine as the local dashboard
- Inbound reply capture and thread matching
- Manual triage for ambiguous replies
- Suppression / do-not-contact policy layer
- Policy-state persistence for cooldowns, manual holds, retry-after, and compliance flags
- Event log and idempotency
- Rule-based scoring and autosend-readiness annotation
- Dockerized runtime with separate dashboard, worker, and Postgres containers
- Local operator workflow through the dashboard container

### Out of MVP

- Autosend
- Automatic follow-up sequences
- Bulk approval or bulk send
- Full CRM/prospect management UI
- Dedicated analytics page
- Outbound attachments
- Multi-user auth/permissions
- Multichannel outreach
- A/B testing
- Complex policy builder

## 5. Runtime Architecture

### Application components

- `Next.js App Router` dashboard, SSR-first
- `TypeScript`
- `Tailwind CSS`
- `Postgres`
- `pgvector`
- `Drizzle ORM`
- `Route Handlers` for mutations/commands
- Shared internal service layer for business logic
- Separate worker/runtime for jobs and heavy processing
- Docker Compose network connecting dashboard, worker, and Postgres

### Webhook ingress boundary

Resend webhook endpoints must stay thin.

Webhook ingress should do only:

- verify provider authenticity
- persist raw payload and headers
- compute dedupe key
- mark duplicate events safely
- enqueue processing in Postgres
- return fast success

Webhook ingress should not do:

- full thread matching
- reply classification
- draft generation
- Telegram notification
- embeddings
- heavy policy transitions

### Why this split

- UI reads through SSR and service-layer reads
- Mutations are explicit command endpoints, not React-bound Server Actions
- Dashboard webhook ingress and worker reuse the same service layer
- Domain logic stays outside React

## 6. Data Model

The MVP should not use one overloaded `emails` table for everything. Minimum entities:

### Organization

Represents the target company/project.

Key concerns:
- normalized domain
- latest research snapshot
- pillar fit
- research status
- outreach status

### Campaign

Represents the top-level operator intent for a bounded outreach motion.

Examples:
- AI integration services outreach campaign
- staking growth outreach campaign

Key concerns:
- campaign objective
- selected pillar
- target segments
- offer/profile context
- operator notes and constraints
- campaign lifecycle (`drafting_scope`, `active`, `paused`, `closed`)
- policy profile / pacing assumptions
- linkage to all derived outreach activity

### Contact

Represents a person or shared mailbox inside an organization.

Key concerns:
- normalized email
- role/title
- source
- confidence
- suitability for outreach
- suppression / reachability
- contact status
- primary/fallback designation
- referred-by linkage when a `wrong_person` reply points to another contact

### Outreach

Represents one outreach initiative to one contact for one pillar.

Key concerns:
- campaign linkage
- primary contact
- current draft pointer
- approval status
- delivery status
- engagement status
- thread ownership status
- initiative-level lifecycle across reassignment, deferral, and closure

### Draft

Versioned artifact produced by the agent or edited by the operator.

Key concerns:
- subject/body
- revision number
- draft model
- confidence breakdown
- feedback tags
- autosend readiness label
- approved canonical version pointer

### Thread

Represents one active company-scoped conversation.

Key concerns:
- one active thread per company
- can include multiple participants
- warm stage continues inside the same thread

### Thread Participant

Allows `info@company.com` to become `john@company.com` without creating a new thread.

### Outbound Message

Actual sent email.

Key concerns:
- canonical sent content
- provider ids
- header/thread linkage
- payload snapshot
- delivery state

### Inbound Message

Actual received email.

Key concerns:
- parsed content
- raw headers
- raw provider payload
- match method/confidence
- intent class
- attachment metadata

### Suppression Entry

Policy constraint for future sending.

Scopes:
- contact
- organization
- domain

### Policy State Entry

Operational state that affects future workflow but is not equivalent to permanent suppression.

Examples:
- cooldown until date
- retry-after date
- manual hold
- manual override
- compliance review flag

This entity is required so the Policies page is backed by durable state rather than derived UI-only concepts.

Recommended fields:

- `id`
- `scope_type`
- `scope_id`
- `state_type`
- `status`
- `reason_code`
- `reason_text` nullable
- `effective_at`
- `expires_at` nullable
- `created_by_type`
- `created_by_id` nullable
- `source_event_id` nullable
- `created_at`
- `resolved_at` nullable
- `resolved_by_operator_id` nullable

### Work Item

Derived or persisted operator task shown in Inbox.

Examples:
- reply needs review
- ambiguous inbound needs manual attach
- cold draft ready
- research needed
- follow-up eligible
- blocked by policy

Work items may be persisted directly or produced by a strict derivation contract, but the implementation must define:
- item type
- source entity
- priority
- status
- owner/assignee if needed
- due/resurface time if applicable
- resolution action
- visibility state
- acknowledgment/snooze/resolution state

### Webhook Event

Raw provider event persisted before domain processing.

Examples:
- inbound email received
- delivery event received
- bounce
- complaint
- unsubscribe

Key concerns:
- provider event type
- provider event id or message id
- raw headers
- raw payload
- dedupe key
- processing status
- received timestamp

### Event Log

Append-only log of system and operator events.

### Idempotency Registry

Used for:
- outbound send
- inbound webhook
- provider event ingestion
- operator actions

## 7. Status Axes

Do not use one global status. Keep separate axes:

- `research_status`
- `campaign_status`
- `contact_status`
- `draft_status`
- `delivery_status`
- `thread_status`
- `outcome_status`
- `policy_state`
- `webhook_event_status`

### Research status

- `new`
- `researching`
- `researched`
- `insufficient_data`
- `archived`

### Campaign status

- `drafting_scope`
- `active`
- `paused`
- `closed`

### Contact status

- `new`
- `candidate`
- `primary`
- `fallback`
- `wrong_person`
- `bounced`
- `do_not_contact`
- `inactive`

### Draft status

- `pending_research`
- `draft_ready`
- `in_review`
- `approved`
- `needs_revision`
- `rejected`
- `superseded`

### Delivery status

- `not_sent`
- `queued`
- `sent`
- `delivered`
- `failed`
- `bounced`
- `complained`
- `suppressed`

### Thread status

- `awaiting_first_send`
- `awaiting_reply`
- `reply_received`
- `reply_draft_ready`
- `needs_reassignment`
- `manual_hold`
- `closed`
- `do_not_contact`

### Outcome status

- `unknown`
- `negative_reply`
- `positive_reply`
- `meeting_requested`
- `meeting_booked`
- `not_now`
- `closed_lost`
- `do_not_contact`

### Policy state

- `none`
- `cooldown`
- `retry_after`
- `manual_hold`
- `manual_override`
- `compliance_flag`

### Webhook event status

- `received`
- `duplicate_ignored`
- `queued_for_processing`
- `processing`
- `processed`
- `processing_failed`
- `dead_lettered`

## 8. Threading and Reply Matching

### Primary rule

Thread matching is **headers-first**:

- `Message-ID`
- `In-Reply-To`
- `References`

### Fallback

If headers are weak or missing:

- same company domain
- normalized subject
- recent active thread window

### Ambiguous inbound

- never auto-resolve silently
- create `manual triage` work item
- operator manually attaches inbound message to a thread

### Webhook processing split

#### At ingress

- verify request
- persist raw webhook event
- apply dedupe
- enqueue `job.process_webhook_event`
- return success quickly

#### In worker

For inbound email:

- parse normalized inbound message
- persist inbound parsed/raw records
- match thread
- classify intent
- update thread/outcome/policy state
- create work item
- generate warm draft when safe
- notify operator when needed

For provider delivery events:

- resolve outbound message
- update delivery state
- create suppression entries when required
- create urgent work items/notifications when required

### Participants

- a new sender inside the same company joins the same thread as a participant
- this does not create a new cold thread

## 9. Operator UX

### Surfaces

- `Next dashboard` is the primary operator surface
- `Telegram` is notification-only in MVP

### Dashboard pages

- `/inbox`
- `/organizations/[organizationId]`
- `/campaigns/[campaignId]` optional in MVP if campaign summary needs a dedicated view; otherwise campaign context can live inside Inbox filters and thread context
- `/threads/[threadId]`
- `/policies`

### Inbox model

Inbox is a **priority work queue**, not a mailbox clone.

Priority order:

1. urgent compliance/delivery issues
2. inbound replies needing operator action
3. ambiguous/unmatched inbound and send reconciliation
4. warm draft review
5. cold draft review
6. research needed
7. non-urgent policy review
8. follow-up eligible
9. low-priority maintenance/review

Each item is one action item, not one raw DB record.

### Thread View model

Thread View has five zones:

1. Header
2. Timeline
3. Active Review Panel
4. Research / Context
5. Policy / Controls

Draft review happens inside Thread View, with optional expanded editor mode.

### Organization detail view

The dashboard must support company-level inspection so the operator can review all work and outcomes for one organization in one place.

Minimum organization detail surface:

- company summary
- linked campaigns
- active and historical outreach attempts
- contacts and participant history
- outcomes and stats
- suppression/cooldown/restrictions
- latest research snapshot

This does **not** require a full CRM-style management list in MVP, but it does require a dedicated organization detail view or equivalent surface.

Organization detail is a read model assembled from domain tables and event history.

It must not become a second CRM truth store.

### Policies page

Policies page is an operational control surface for:

- suppression list
- cooldowns
- manual overrides
- compliance/delivery flags

## 10. Review Actions

### Cold and warm draft actions

- `Approve and Send`
- `Edit Manually`
- `Revise with AI`
- `Research More`
- `Skip`

### Campaign-level operator actions

- `Start Campaign`
- `Pause Campaign`
- `Resume Campaign`
- `Close Campaign`

### Campaign lifecycle behavior

`drafting_scope`
- campaign intent and scope are being prepared
- worker does not yet expand the campaign into active cold motion

`active`
- worker may discover prospects
- enrich organizations
- select contacts
- generate cold drafts
- create review work items

`paused`
- stops new cold outreach expansion for this campaign
- does not block inbound processing, reply handling, or compliance/suppression updates
- historical and current threads remain visible

`closed`
- stops further campaign-driven cold expansion
- preserves history and reporting
- existing threads remain visible; any later warm handling is treated as an exception/manual decision, not normal campaign expansion

### Important distinctions

- `Manual Edit` creates a new draft version
- `AI Revise` creates a new draft version and stores instruction/tags
- `Research More` launches a new research pass, not just a rewrite

### Removed from MVP

- `Approve All`
- `Send Generic`

## 11. Reply Handling

### Reply classes

- `positive_interest`
- `question`
- `neutral`
- `not_now`
- `wrong_person`
- `negative`
- `unsubscribe`
- `auto_reply_or_noise`

### Warm draft policy

- do not generate warm draft for every inbound blindly
- classify inbound first
- auto-create warm draft only for safe classes
- risky classes go to manual/operator review

### Special reply flows

#### wrong_person

- does not close the thread as negative
- captures referred contact if present
- sets thread to `needs_reassignment`
- new outbound to the referred contact still requires operator review

#### not_now

- becomes deferred state
- stores retry/cooldown date
- does not auto-generate immediate acknowledgment by default

#### unsubscribe / complaint / hard bounce

- create suppression entry automatically
- update contact status
- update thread and outcome state
- create urgent operator notification
- block future sends immediately

## 12. Pre-Send Guardrails

Sending is manual, but guarded.

### Hard blocks

- suppression/do-not-contact
- duplicate send/idempotency conflict
- invalid recipient state
- unresolved thread ambiguity
- policy violation

### Warning/confirm

- suboptimal recipient-local timing
- uncertain timezone
- soft risk markers

### Advisory only

- timing recommendation
- quality/readiness hints

Cold and warm sends use different policy buckets:

- warm replies are higher priority
- cold caps must not block warm replies

## 13. Timing Model

Because sending is operator-controlled:

- the system does not own the send schedule
- it provides timing advice
- timing should be evaluated relative to the recipient timezone when possible

Cold sends use stricter recipient-local timing guidance than warm replies.

## 14. Notifications

Telegram should notify only on urgent/high-value events:

- new inbound reply
- ambiguous reply needing manual attach
- serious send failure
- unsubscribe / complaint / hard bounce
- reassignment-needed cases

Draft-ready events can be batched as summaries.

Routine noise stays in dashboard only.

Because the dashboard is local-only in MVP, Telegram deep links are only considered actionable in the desktop/local workflow. Mobile Telegram notifications may be informational-only.

## 15. Scoring and Future Learning

### Quality score

Rule-based score informed by:

- operator actions
- edit severity
- feedback tags
- reply class
- business outcome
- negative safety events

### Operator feedback as primary signal

Strong early signals:

- approved as-is
- minor edit
- major edit
- redo
- skip
- reason tags

### Autosend readiness

- exists in MVP as an annotation
- primary storage is draft-level
- assigned rule-based by default
- operator override allowed
- does not control sending yet

### Feedback signal capture

Store both explicit and implicit operator feedback.

Explicit feedback:

- feedback tags
- free-text notes
- reject/skip reason
- revise instruction
- research-more reason
- manual override reason

Implicit feedback:

- approved as-is
- approved after minor edit
- approved after major edit
- rejected
- skipped
- claim removed
- sources opened before approval
- research requested before approval
- AI revise requested before approval

Implicit signals should be derived from events and version history, not guessed from raw text alone.

### Edit severity

Manual edits should be classified deterministically.

Recommended severity labels:

- `none`
- `minor`
- `moderate`
- `major`
- `rewrite`

Signals:

- subject changed
- body diff ratio
- claim count changed
- unsupported claim removed
- CTA changed
- personalization removed or added
- tone/length changed materially

Edit severity is a learning signal and should not be used as a send blocker by itself.

### Quality score inputs

Quality score should be rule-based in MVP.

Inputs:

- approval outcome
- edit severity
- feedback tags
- claim safety status
- fact support strength
- reply class/outcome after send
- bounce/complaint/unsubscribe safety events
- warm/cold context
- operator override presence

Quality score should store reason tags, not just a number.

### Autosend readiness labels

Draft-level autosend readiness labels:

- `not_ready`
- `low_confidence`
- `promising`
- `high_confidence`
- `blocked_by_policy`
- `blocked_by_facts`

Readiness is an annotation only in MVP.

It does not send email and does not bypass operator approval.

## 16. RAG / Semantic Memory

RAG is part of MVP, but only as a memory layer.

### Source of truth

Structured DB and service layer:

- threads
- drafts
- outbound messages
- inbound messages
- outcomes
- policy state
- event log

### RAG role

- retrieve similar approved cold drafts
- retrieve similar warm replies
- retrieve relevant operator feedback
- retrieve useful prior examples for generation

### Storage and indexing

- vector storage lives in `Postgres` via `pgvector`
- vector indexing is planned with `HNSW`
- retrieval always uses structured narrowing before vector search

Required indexing layers:

1. structured SQL indexes for metadata filters
2. vector index for semantic retrieval

Structured narrowing should filter by fields such as:

- artifact type
- pillar
- reply class
- contact type
- quality score band
- outcome status
- approved vs rejected
- recency

### Positive and negative corpora

RAG should not treat all texts as equally good references.

#### Positive corpus

Used as the main reference set for generation:

- approved cold drafts
- approved warm replies
- useful thread summaries
- operator feedback summaries that encode successful patterns

#### Negative corpus

Used as anti-pattern memory:

- rejected drafts
- major-redo drafts
- drafts with strong negative reason tags
- texts linked to negative safety outcomes

Rejected drafts must be stored and indexed, but they should not be mixed into the main positive retrieval set.

### Retrieval strategy

Retrieval pipeline:

1. structured narrowing
2. semantic search
3. quality-aware rerank

Rerank should consider:

- quality score
- outcome labels
- operator feedback tags
- recency
- approval/finality

### Document model

RAG should index curated artifact documents, not raw system noise.

Likely artifact families:

- approved cold draft
- approved warm reply
- rejected draft
- operator feedback note
- thread summary
- research snapshot

Each indexed document should carry metadata sufficient for structured filtering and quality-aware reranking.

### Not allowed

- no policy decisions from RAG
- no thread matching from RAG
- no send permission from RAG
- no blocking dependency on RAG availability

### Suggested MVP stack

- `Postgres + pgvector`
- curated embeddings only
- generated asynchronously by the worker
- retrieval pipeline: structured narrowing -> semantic retrieval -> quality-aware ranking

## 17. Observability and History

### Required from day one

- append-only event log
- raw + parsed inbound storage
- layered outbound storage
- raw webhook event persistence before domain processing
- idempotent processing for sends and provider events
- idempotent processing for operator commands
- duplicate-safe webhook ingestion
- timeline derived from messages + event log

### No separate presentation-history table

Timeline is a curated view over:

- messages
- event log

## 18. MVP Summary

This MVP is:

- local-first
- operator-controlled
- event-driven
- thread-aware
- policy-guarded
- learning-oriented

## 19. Worker Orchestration Model

Worker orchestration is **event-driven staged orchestration**, not a single linear blocking pipeline.

### Principles

- execution is asynchronous
- multiple flows can progress independently
- each stage has an explicit handler contract
- state transitions are driven by commands and events
- no free-form autonomous agent mesh in MVP

### What this means

The system should support several independent but coordinated flows:

- cold outreach preparation
- inbound reply handling
- delivery/compliance processing
- memory/RAG indexing
- follow-up eligibility and resurfacing

These flows must not wait on each other unless a real dependency exists.

### Where determinism still matters

Determinism is required at the domain-contract level:

- a handler knows which commands/events it reacts to
- a handler has a bounded set of side effects
- state transitions are explicit and observable
- retries and replays remain explainable

Determinism is **not** a requirement that all work execute in one strict serial chain.

### What is explicitly out of scope

- agents deciding their own next stage without bounded contracts
- arbitrary agent-to-agent delegation graphs
- hidden autonomous planning loops inside the worker

The worker may use LLM/agent logic inside a stage handler, but stage ownership and transitions remain explicit.

## 20. Campaign-Oriented Orchestration

Operator commands should be high-level and campaign-oriented, not low-level draft instructions.

### Operator command layer

Typical operator commands:

- `start_campaign`
- `pause_campaign`
- `resume_campaign`
- `close_campaign`
- `approve_draft_for_send`
- `request_ai_revise`
- `request_research_more`
- `handle_thread_manually`
- `suppress_contact`
- `attach_inbound_to_thread`

The operator should not manually issue internal commands like:

- `generate_draft`
- `classify_reply`
- `select_contact`
- `run_research`

Those belong to the worker's internal orchestration.

### Internal system command layer

The worker derives internal commands/jobs from campaign intent, for example:

- discover prospects
- enrich organization
- select primary contact
- generate cold draft
- process inbound reply
- classify reply
- generate warm draft
- index memory artifacts

### Why Campaign is first-class

Without `Campaign`, the top-level intent that starts a multi-step outreach motion is lost.

`Campaign` is needed to:

- capture operator intent
- scope discovery and drafting
- link many outreach records to one mission
- allow pause/resume/close at the mission level
- compare results by outreach motion later

### What Campaign stores

Minimum useful fields:

- campaign identity (`id`, `name`, `pillar`)
- objective
- offer summary
- desired CTA
- target segments
- include/exclude constraints
- operator notes
- positioning notes
- forbidden claims
- discovery source hints
- initial target countries/timezones if relevant
- max organizations to discover
- max active organizations
- max draft backlog
- per-run discovery batch size
- campaign status
- priority
- paused_reason nullable
- closed_reason nullable
- created/started/paused/closed timestamps

### Relationship

- one `Campaign` can produce many `Outreach` records
- one `Outreach` belongs to exactly one `Campaign`
- worker orchestration unfolds campaign intent into many internal commands/jobs/events

### What pause/resume controls

`pause` blocks:

- new prospect discovery for this campaign
- new organization enrichment spawned by this campaign
- new cold draft generation
- new campaign-driven cold expansion work

`pause` does not block:

- inbound webhook processing
- thread matching
- reply classification
- warm reply handling for already-open threads
- suppression/compliance updates
- operator inspection and manual actions

### Campaign start behavior

`start_campaign` must not synchronously run discovery, enrichment, or draft generation inline.

When a campaign starts, the system should:

- validate campaign readiness
- move campaign status to `active`
- append `campaign_started`
- create a small initial set of internal commands/jobs

Typical initial orchestration seed:

- discover prospects for campaign
- refresh campaign memory/context
- materialize campaign work queue/counters as needed

Campaign expansion then proceeds asynchronously via event-driven handlers.

`start_campaign` is therefore a seed action, not a giant blocking orchestration step.

### Campaign expansion flow

Typical expansion path:

1. `campaign_started`
2. prospect discovery requested
3. organization discovered
4. organization enrichment requested
5. organization enriched or marked insufficient
6. primary contact selection requested
7. contact selected or no actionable contact found
8. cold draft requested
9. draft created
10. review work item created

### Expansion pacing

Campaign expansion must be bounded.

The worker should enforce:

- bounded discovery fan-out
- per-campaign concurrency limits
- queue depth limits
- no unbounded draft generation burst from one campaign

It is **not** yet:

- autonomous

### Campaign readiness

`start_campaign` requires enough structured scope to avoid open-ended agent behavior.

Minimum readiness fields:

- objective
- offer summary
- desired CTA
- target segment or exclusion guidance
- forbidden claims
- sender identity
- policy profile
- at least one discovery source strategy or seed list/source hint

If readiness is incomplete:

- do not start expansion
- keep campaign in `drafting_scope`
- create `campaign_scope_incomplete` work item

### Expansion limits

Campaign expansion should use explicit caps.

Recommended controls:

- `max_organizations_to_discover`
- `max_new_organizations_per_run`
- `max_concurrent_enrichments`
- `max_concurrent_drafts`
- `max_open_draft_reviews`
- `max_daily_send_requests` advisory in MVP because sends are manual
- `cooldown_between_discovery_runs`

Defaults can be conservative in MVP and configurable later.

### Expansion window

One campaign expansion pass should do bounded work, then stop.

Example pass:

1. discover up to N candidate organizations
2. persist candidates that pass deterministic dedupe/policy filters
3. enqueue enrichment for up to available enrichment capacity
4. stop when draft backlog or queue-depth limits are reached

Further expansion is triggered by:

- operator resume/start
- backlog falling below threshold
- scheduled campaign tick
- explicit operator request

### Pause behavior

When a campaign is paused:

- new discovery jobs should not start
- new organization enrichment for this campaign should not start unless already in progress and safe to finish
- new cold draft generation should not start
- pending cold expansion jobs should become blocked/deferred, not deleted
- existing draft review work remains visible
- inbound/warm/compliance processing continues

Paused campaigns can still receive manual operator actions such as review, suppress, close, or inspect.

### Resume behavior

`resume_campaign` moves the campaign back to `active` and creates a small expansion tick only if capacity allows.

It should not replay the entire original start fan-out.

Resume should:

- clear pause metadata
- append `campaign_resumed`
- recompute campaign work/counters
- enqueue bounded expansion if backlog is below limits

### Close behavior

`close_campaign` stops normal cold expansion permanently.

Close should:

- mark campaign `closed`
- append `campaign_closed`
- supersede cold expansion work items
- prevent new cold discovery/enrichment/drafting
- keep historical data, drafts, threads, outcomes, and research visible

Close does not delete data.

Inbound replies after close are still ingested and shown, but warm handling becomes manual/exceptional rather than normal campaign continuation.

### Command/job gating by status

Allowed in `drafting_scope`:

- edit campaign scope
- start campaign if ready
- inspect campaign

Allowed in `active`:

- discovery
- enrichment
- contact selection
- cold draft generation
- draft review
- inbound/warm processing

Allowed in `paused`:

- inspect
- resume
- close
- manual draft review
- suppression/policy actions
- inbound/warm/compliance processing

Blocked in `paused`:

- new discovery
- new cold enrichment
- new cold draft generation

Allowed in `closed`:

- inspect
- reporting
- suppression/policy actions
- inbound capture
- manual exceptional warm handling

Blocked in `closed`:

- new cold discovery
- new cold enrichment
- new cold draft generation
- normal follow-up expansion

## 21. Orchestration Vocabulary

The worker needs a small stable vocabulary for intents, executable work, and facts.

### Commands

Commands express intent.

They are imperative and use `verb_object` naming.

#### Operator commands

- `start_campaign`
- `pause_campaign`
- `resume_campaign`
- `close_campaign`
- `approve_draft_for_send`
- `request_manual_edit_save`
- `request_ai_revise`
- `request_research_more`
- `skip_draft`
- `attach_inbound_to_thread`
- `mark_thread_manual_hold`
- `return_thread_to_agent`
- `close_thread`
- `reassign_thread_contact`
- `suppress_contact`
- `unsuppress_contact`
- `suppress_organization`
- `apply_cooldown`
- `remove_cooldown`
- `create_followup_draft` manual only from an Inbox reminder; it does not create an automatic sequence and never sends without operator approval

#### Internal system commands

- `discover_prospects_for_campaign`
- `refresh_campaign_context`
- `enrich_organization`
- `refresh_research_snapshot`
- `select_primary_contact`
- `generate_cold_draft`
- `generate_warm_draft`
- `process_inbound_message`
- `classify_reply`
- `attempt_thread_match`
- `index_rag_document`
- `refresh_thread_summary`
- `recompute_work_items`
- `recompute_quality_score`
- `recompute_readiness_label`

### Jobs

Jobs describe executable worker tasks. They are retryable and leaseable.

- `job.process_webhook_event`
- `job.process_provider_event`
- `job.enrich_organization`
- `job.refresh_research_snapshot`
- `job.select_primary_contact`
- `job.generate_cold_draft`
- `job.generate_warm_draft`
- `job.send_email`
- `job.match_thread`
- `job.classify_reply`
- `job.index_rag_document`
- `job.refresh_thread_summary`
- `job.recompute_work_items`
- `job.recompute_scores`
- `job.resurface_deferred_items`
- `job.send_telegram_notification`
- `job.send_digest`

### Events

Events are append-only facts and use past-tense business-readable names.

#### Campaign

- `campaign_started`
- `campaign_paused`
- `campaign_resumed`
- `campaign_closed`

#### Discovery and research

- `prospect_discovery_requested`
- `organization_discovered`
- `organization_enrichment_requested`
- `organization_enriched`
- `organization_marked_insufficient`

#### Contacting

- `primary_contact_selected`
- `no_actionable_contact_found`
- `contact_referred_from_reply`

#### Drafting and review

- `cold_draft_requested`
- `cold_draft_created`
- `warm_draft_requested`
- `warm_draft_created`
- `draft_revision_requested`
- `draft_researched_again`
- `draft_skipped`
- `draft_approved_for_send`
- `draft_sent_for_manual_edit`
- `draft_returned_for_ai_revise`

#### Delivery

- `outbound_send_requested`
- `outbound_send_attempted`
- `outbound_sent`
- `outbound_send_failed`
- `delivery_updated`
- `hard_bounce_received`
- `complaint_received`
- `unsubscribe_received`

#### Inbound and thread handling

- `webhook_event_received`
- `inbound_message_persisted`
- `thread_matched`
- `thread_match_ambiguous`
- `reply_classified`
- `thread_moved_to_manual_hold`
- `thread_reassigned`

#### Policy and work queue

- `suppression_created`
- `suppression_removed`
- `cooldown_applied`
- `cooldown_removed`
- `work_item_created`
- `work_item_updated`
- `work_item_resolved`

#### Memory and learning

- `rag_document_indexed`
- `thread_summary_refreshed`
- `quality_score_updated`
- `autosend_readiness_updated`

Commands express business intent, jobs express executable worker work, and events express facts that already happened. These categories must stay distinct.

## 22. Command Handler vs Worker Boundary

The system should use a hybrid boundary:

- command handlers are thin and synchronous
- worker jobs perform heavy execution and external side effects

### Command handler responsibilities

Command handlers may:

- accept operator or system intent
- enforce idempotency
- perform lightweight validation
- write the command record
- make small immediate state transitions when the intent itself is already a fact
- append immediate events for those state transitions
- enqueue one or more worker jobs

### Command handlers must not do

- LLM calls
- heavy research/enrichment
- draft generation
- email sending
- thread matching
- embeddings
- long orchestration chains

### Worker responsibilities

Worker jobs perform:

- heavy domain work
- external integrations
- retries
- fan-out into subsequent jobs
- events for completed work or failed work

### Immediate state transitions are allowed when

- the operator decision itself is the fact being recorded
- the state change is small and synchronous
- the heavy work still happens later in the worker

Examples:

- `start_campaign` may immediately move a campaign to `active`
- `pause_campaign` may immediately move a campaign to `paused`
- `approve_draft_for_send` may immediately mark a draft as approved/requested-for-send

### Enqueue-only commands

Commands that represent heavy computation or side-effecting work should remain enqueue-only and should not mutate domain outcome state before execution completes.

Examples:

- `generate_cold_draft`
- `generate_warm_draft`
- `classify_reply`
- `job.process_webhook_event`
- `send_email`

### Execution pattern

1. a command captures intent
2. the command handler performs lightweight validation and immediate state transitions where appropriate
3. the command handler enqueues jobs
4. the worker executes jobs
5. the worker appends events and may enqueue subsequent jobs

## 23. Immediate-Transition vs Enqueue-Only Commands

Not every command should behave the same way.

### Immediate-transition commands

These commands may synchronously mutate domain state because the decision itself is already a fact.

#### Campaign lifecycle

- `start_campaign`
- `pause_campaign`
- `resume_campaign`
- `close_campaign`

#### Draft review decisions

- `approve_draft_for_send`
- `request_manual_edit_save`
- `skip_draft`

#### Thread and policy decisions

- `mark_thread_manual_hold`
- `close_thread`
- `reassign_thread_contact`
- `suppress_contact`
- `unsuppress_contact`
- `suppress_organization`
- `apply_cooldown`
- `remove_cooldown`

These commands may still enqueue follow-up jobs after the immediate transition.

Examples:

- `start_campaign` -> move campaign to `active`, then enqueue discovery work
- `approve_draft_for_send` -> mark draft approved, then enqueue `job.send_email`
- `reassign_thread_contact` -> record reassignment, then enqueue derived recalculation work

### Enqueue-only commands

These commands must not claim that the domain outcome already exists before worker execution finishes.

#### Research and generation

- `request_ai_revise`
- `request_research_more`
- `create_followup_draft`
- `discover_prospects_for_campaign`
- `refresh_campaign_context`
- `enrich_organization`
- `refresh_research_snapshot`
- `select_primary_contact`
- `generate_cold_draft`
- `generate_warm_draft`

#### Inbound processing

- `job.process_webhook_event`
- `process_inbound_message`
- `attempt_thread_match`
- `classify_reply`

#### Memory and recompute

- `index_rag_document`
- `refresh_thread_summary`
- `recompute_work_items`
- `recompute_quality_score`
- `recompute_readiness_label`

### Important edge cases

- `request_manual_edit_save` is immediate only when the payload already contains the saved new draft content
- `request_ai_revise` is enqueue-only; the system may record `draft_revision_requested` immediately, but not `draft_revised`
- `approve_draft_for_send` may record approval immediately, but `outbound_sent` must only be emitted by worker execution

## 24. Telegram as a Secondary Command Surface

Telegram may later act as a second command surface, but not as the primary control plane in MVP.

### Core principle

- `Dashboard` and `Telegram bot` must both map into the same persisted command system
- neither surface should execute business logic directly
- both surfaces should rely on the same command handlers, jobs, and events

### What this enables

Telegram may support bounded operator actions such as:

- pause a campaign
- resume a campaign
- mark a thread on manual hold
- approve a draft
- inspect a company or thread summary

### MVP boundary

In MVP:

- dashboard remains the primary control surface
- Telegram remains notification-first
- bounded structured bot commands are allowed as an extension point
- free-form natural-language campaign creation from Telegram is deferred

### Why free-form natural-language command parsing is deferred

Campaign creation depends on structured fields such as:

- objective
- offer summary
- targeting constraints
- exclusions
- policy profile
- operator notes

Allowing free-form natural-language command creation too early would shift complexity into command parsing instead of workflow reliability.

### Recommended maturity path

1. notifications plus deep links
2. bounded slash/menu commands that map into structured commands
3. later, optional natural-language command parsing with confirmation before command creation

## 25. Commands Table Model

The system should use one shared durable `commands` table.

It must store:

- operator commands
- internal system commands

Webhook ingress itself does not create provider-fact commands.

Ingress persists `webhook_events` and enqueues processing jobs. Downstream commands may be created later only after worker interpretation when there is an actual system intent to express.

### Why one table

- one audit trail for all intent
- one lifecycle model for accepted, deduplicated, rejected, queued, executing, completed, and failed commands
- simpler idempotency handling
- simpler tracing from operator intent into internal orchestration

### Distinguishing fields

Commands should be differentiated by:

- `source`: `operator`, `system`, `telegram`
- webhook provider facts are stored in `webhook_events`, not in `commands`; any later command derived from webhook processing uses `source=system` with causation metadata
- `command_type`
- `actor_id` where applicable
- `target_entity_type`
- `target_entity_id`

### Recommended fields

- `id`
- `command_type`
- `source`
- `actor_id` nullable
- `target_entity_type`
- `target_entity_id`
- `payload_json`
- `status`
- `idempotency_key`
- `correlation_id`
- `parent_command_id` nullable
- `causation_event_id` nullable
- `accepted_at`
- `started_at`
- `completed_at`
- `failed_at`
- `failure_reason`

### Statuses

- `accepted`
- `deduplicated`
- `rejected`
- `queued`
- `executing`
- `completed`
- `failed`

### Important boundary

Not every micro-step should become a persisted command.

Persisted commands are for meaningful orchestration intents such as:

- `start_campaign`
- `discover_prospects_for_campaign`
- `generate_cold_draft`
- `classify_reply`

Micro-operations inside job execution should remain internal implementation details.

## 26. Jobs Table and Worker Leasing Model

The system needs a separate durable `jobs` table.

Commands do not replace jobs:

- command = intent
- job = executable unit of work

### Recommended fields

- `id`
- `job_type`
- `status`
- `payload_json`
- `priority`
- `available_at`
- `lease_token` nullable
- `leased_until` nullable
- `attempt_count`
- `max_attempts`
- `last_error`
- `created_at`
- `started_at`
- `completed_at`
- `failed_at`
- `correlation_id`
- `command_id` nullable
- `causation_event_id` nullable
- `target_entity_type`
- `target_entity_id`
- `concurrency_key` nullable

### Recommended statuses

- `queued`
- `leased`
- `completed`
- `failed`
- `exhausted`
- `cancelled`

### Lease model

Worker execution should be lease-based, not fire-and-forget.

When a worker claims a job it should:

- select an eligible queued job
- assign `lease_token`
- assign `leased_until`
- mark the job `leased`

If the worker dies before completion, the lease expires and the job becomes eligible again.

### Polling model

For MVP the worker should poll Postgres for eligible jobs.

Selection priority should consider:

1. `available_at`
2. `priority`
3. `created_at`

### Retries

Retries should be built into the jobs model.

On failure:

- if the error is retryable and `attempt_count < max_attempts`, reschedule with new `available_at`
- otherwise move to `exhausted` or `failed`

Backoff may remain simple and deterministic in MVP.

### Concurrency control

The worker should support `concurrency_key` so conflicting jobs do not run in parallel.

Examples:

- `campaign:{id}`
- `organization:{id}`
- `thread:{id}`

This prevents conflicting mutations without requiring a broker.

### Operational visibility

Exhausted and failed jobs must remain visible through event log and operational surfaces. They must not disappear into worker logs.

## 27. Job Runs / Attempt History

The system should use a separate `job_runs` table in addition to `jobs`.

### Why

- `jobs` stores the current durable queue state
- `job_runs` stores execution-attempt history

One job may be attempted several times. A single row in `jobs` is not enough to explain retry history, worker ownership, or per-attempt errors.

### Recommended fields

- `id`
- `job_id`
- `attempt_number`
- `worker_id`
- `lease_token`
- `status`
- `started_at`
- `finished_at`
- `duration_ms` optional or derived
- `error_class`
- `error_message`
- `retryable`
- `created_at`

Optional later fields:

- `failure_payload_json`
- `result_summary_json`

### Recommended statuses

- `started`
- `completed`
- `failed`
- `abandoned`
- `timed_out`

### Responsibility split

- `commands` = intent
- `jobs` = current executable work state
- `job_runs` = execution-attempt history
- `event_log` = business/system facts

`job_runs` exists so execution telemetry does not pollute business-readable event history.

## 28. Event Log vs Technical Telemetry

`event_log` must remain readable and domain-oriented.

### Event log should contain

Only facts that explain product or workflow behavior.

Examples:

- operator decisions such as `campaign_started`, `draft_approved_for_send`, `draft_skipped`
- domain/system outcomes such as `organization_discovered`, `organization_enriched`, `primary_contact_selected`
- drafting outcomes such as `cold_draft_created`, `warm_draft_created`
- thread outcomes such as `thread_matched`, `thread_match_ambiguous`, `reply_classified`
- delivery/compliance outcomes such as `outbound_sent`, `outbound_send_failed`, `unsubscribe_received`, `complaint_received`, `hard_bounce_received`
- policy and learning transitions such as `suppression_created`, `cooldown_applied`, `quality_score_updated`, `autosend_readiness_updated`
- work-queue outcomes such as `work_item_created`

### Event log should not contain

Low-level execution noise must stay out of the business-readable event log.

Examples:

- lease acquired
- attempt 2 started
- lease renewed
- poll loop tick
- worker claimed batch
- retry scheduled in 30 seconds
- subject normalization
- HTML stripping
- embedding payload preparation
- prompt assembly internals

### Failure rule

Failures belong in `event_log` only when they become meaningful workflow or product outcomes.

Examples:

- `outbound_send_failed`
- `cold_draft_failed`
- `warm_draft_failed`
- optionally `organization_enrichment_failed` if it materially blocks the flow

Transient attempt failures that are still being retried belong in `job_runs`, not `event_log`.

### Responsibility split

- `event_log` = domain/system facts suitable for timeline, debugging, and learning
- `job_runs` = execution telemetry and retry noise

## 29. Event Log Required Fields

The event log needs more than `event_type + payload + timestamp`.

### Required fields

- `id`
- `event_type`
- `entity_type`
- `entity_id`
- `thread_id` nullable
- `organization_id` nullable
- `campaign_id` nullable
- `outreach_id` nullable
- `actor_type`
- `actor_id` nullable
- `payload_json`
- `created_at`
- `correlation_id`
- `causation_event_id` nullable
- `command_id` nullable
- `job_id` nullable
- `job_run_id` nullable
- `summary_text` nullable

### Why these fields matter

- `entity_type` and `entity_id` identify the primary object
- lineage fields such as `thread_id`, `organization_id`, `campaign_id`, and `outreach_id` make timeline and dashboard queries practical
- `actor_type` and `actor_id` distinguish operator decisions from system or ingress activity
- `correlation_id` ties together one multi-step flow
- `causation_event_id` supports event-driven chains
- `command_id`, `job_id`, and `job_run_id` allow drilling from domain history into execution history
- `summary_text` gives the UI a concise readable line without reinterpreting raw payload every time

### Recommended indexes

- `(entity_type, entity_id, created_at)`
- `(thread_id, created_at)`
- `(organization_id, created_at)`
- `(campaign_id, created_at)`
- `(outreach_id, created_at)`
- `(correlation_id)`
- `(command_id)`
- `(job_id)`

### Important boundary

The event log is append-only history, not a full state snapshot store and not a pure event-sourcing reconstruction log.

## 30. Correlation Model

For MVP the system should use a single explicit `correlation_id`.

It does not need a separate `trace_id` / `span_id` split yet.

### Why one correlation id is enough

The system primarily needs to answer:

- which commands, jobs, and events belong to one logical workflow
- how to follow an operator action into downstream execution
- how to follow a webhook into parsing, matching, classification, and drafting
- how to follow a campaign start into discovery and first-wave orchestration

One `correlation_id` is enough for this level of tracing.

### What correlation_id means

`correlation_id` identifies one logical workflow chain.

Examples:

- one `approve_draft_for_send` flow
- one inbound webhook processing flow
- one `request_ai_revise` flow
- one root `start_campaign` expansion chain

### Why not split into trace/span yet

Separate `trace_id` / `span_id` becomes useful only when:

- distributed tracing across many services is needed
- nested execution spans matter operationally
- performance tracing requires an APM-style model

That would add complexity too early in MVP.

### Recommended companion fields

Instead of full tracing split, MVP should rely on:

- `correlation_id`
- `parent_command_id`
- `causation_event_id`
- `job_id`
- `job_run_id`

Together these are sufficient for causality and debugging.

## 31. Correlation ID Creation and Inheritance

`correlation_id` must follow simple deterministic inheritance rules.

### Root creation

A new `correlation_id` is created at the start of a new logical workflow chain.

#### Operator-originated roots

Examples:

- `start_campaign`
- `approve_draft_for_send`
- `request_ai_revise`
- `request_research_more`
- `reassign_thread_contact`
- `suppress_contact`

Each independent operator action gets its own root `correlation_id`.

#### Webhook-originated roots

A new `correlation_id` is created when webhook ingress accepts a new inbound or provider event and persists it.

Examples:

- inbound reply webhook
- provider delivery event webhook

#### Scheduled/system roots

If the system later runs scheduled sweeps such as digests or deferred-item resurfacing, each root scheduled run gets its own `correlation_id`.

### Inheritance rule

Once a root workflow exists, all downstream commands, jobs, and events inherit the same `correlation_id` while they remain part of that same logical flow.

Examples:

- `approve_draft_for_send` -> `job.send_email` -> `outbound_send_attempted` -> `outbound_sent`
- webhook persisted -> `job.process_webhook_event` -> `inbound_message_persisted` -> `reply_classified` -> `warm_draft_created`

### When to create a new correlation id

A new `correlation_id` must be created when a new independent decision/action flow starts, even if it targets the same entity.

Example:

- an operator requests AI revise on a draft
- later requests another AI revise on the same draft

These are two different flows and must not reuse the same correlation id.

### How lineage is preserved across flows

Even when a new `correlation_id` is created, lineage must still be preserved through:

- `parent_command_id`
- `causation_event_id`
- shared entity references such as `thread_id`, `outreach_id`, and `organization_id`

### Retry rule

Retries do not create a new `correlation_id`.

Retry identity is handled through:

- `job_id`
- `job_run_id`
- `attempt_number`

The correlation remains the same logical workflow chain.

## 32. Jobs as the Practical Outbox

The MVP does not need a separate dedicated outbox table.

Instead, the system should use the `jobs` table as the practical durable outbox mechanism for external side effects.

### Core rule

When domain state changes require an external side effect:

- commit the domain state change
- create the corresponding job in the same database transaction
- let the worker execute the side effect later

This preserves the important outbox property without introducing an additional outbox subsystem.

### Why this is enough in MVP

The system already has:

- durable commands
- durable jobs
- durable job runs
- idempotency
- retries
- correlation and causality tracing

Using `jobs` as the external side-effect queue is therefore sufficient and simpler than adding `outbox_messages`.

### Strict boundary

External side effects must not run directly from command handlers.

They must run only from worker jobs.

Examples:

- email sending
- Telegram notification sending
- outbound API calls that matter operationally

### Important transactional rule

The pattern works only if:

- state change and job creation happen in one transaction
- the side effect is executed only from the durable job
- idempotency exists on the external side effect itself

### Future evolution

If the system later grows into many external consumers or event-publication transports, a dedicated outbox layer can be added. MVP does not require it.

## 33. Job Classes by External-Risk Level

Not all jobs need the same operational policy.

The system should explicitly distinguish job classes by external-risk level.

### Class A: outward communication jobs

These are the most sensitive jobs because they create visible outbound communication.

Examples:

- `job.send_email`
- `job.send_telegram_notification`

Requirements:

- strongest idempotency guarantees
- clear exhausted-state visibility
- careful retry policy
- operator-visible final failure for important job types

`job.send_email` is the strictest job type in the system.

### Class B: external compute/provider jobs

These use external APIs or providers but do not create direct outbound communication to a prospect.

Examples:

- `job.call_llm_provider`
- `job.call_embedding_provider`
- `job.call_enrichment_provider`

Requirements:

- retries and observability
- quota-aware handling
- exhausted visibility
- lower reputational risk than Class A

### Class C: internal compute/state jobs

These operate only on internal state or local computation.

Examples:

- `job.match_thread`
- `job.classify_reply`
- `job.recompute_work_items`
- `job.refresh_thread_summary`
- `job.resurface_deferred_items`

Requirements:

- correctness
- idempotency
- visibility when exhausted

But they do not need the same external-side-effect guardrails as Class A.

### Why this classification matters

Job class affects:

- retry policy
- alerting and operator visibility
- exhausted-state severity
- event-log surfacing rules
- operational escalation

## 34. Retry Policy by Job Class

Retry policy must not be one global rule for all jobs.

It should vary by:

- job class
- job type
- error class

### Class A: outward communication jobs

#### `job.send_email`

This is the strictest retry policy in the system.

Rules:

- retry only on clearly transient failures
- always reuse the same idempotency key
- keep retries tightly bounded
- never blindly retry ambiguous send outcomes

Retryable examples:

- timeout before confirmed response
- transient network failure
- provider 5xx
- explicit retry-after / safe 429 handling

Not retryable examples:

- policy violation
- invalid payload
- suppression hit
- invalid recipient state
- known hard rejection

Ambiguous outcomes must go to reconciliation/manual handling, not blind retry.

#### `job.send_telegram_notification`

- still bounded and idempotent
- more permissive than email
- lower failure severity than `job.send_email`

### Class B: external compute/provider jobs

Examples:

- `job.call_llm_provider`
- `job.call_embedding_provider`
- `job.call_enrichment_provider`

Rules:

- retry on transient provider/network/rate-limit errors
- bounded retries
- simple deterministic backoff
- exhausted failures remain visible but usually do not represent reputational incidents

### Class C: internal compute/state jobs

Examples:

- `job.match_thread`
- `job.classify_reply`
- `job.recompute_work_items`
- `job.refresh_thread_summary`

Rules:

- retry on transient DB/lock/contention issues
- deterministic invalid-state failures are not retryable
- broader retry window than Class A is acceptable

### Configuration shape

Retry policy should be configurable per job type with class defaults.

Recommended fields:

- `max_attempts`
- `base_backoff_seconds`
- `max_backoff_seconds`
- `retryable_error_classes`
- `requires_manual_reconcile_on_ambiguity`
- `final_failure_severity`

### MVP recommendation

- Class A defaults = strictest
- Class B defaults = moderate
- Class C defaults = moderate but internal-facing
- per-job-type overrides are allowed where needed

## 35. Concurrency Keys and Conflict Domains

The worker needs lightweight conflict serialization for jobs that mutate shared state.

Each job may carry one optional `concurrency_key`.

The worker should not lease conflicting jobs with the same key at the same time.

### Primary conflict domains

#### `campaign:{id}`

Use for jobs that mutate campaign-level orchestration state.

Examples:

- `discover_prospects_for_campaign`
- `refresh_campaign_context`
- campaign-level queue materialization

#### `organization:{id}`

Use for jobs that mutate organization-level research or contact state.

Examples:

- `enrich_organization`
- contact selection
- organization-level suppression/reachability writeback

#### `thread:{id}`

Use for jobs that mutate conversation/thread state.

Examples:

- matched inbound processing
- reply classification writeback
- warm draft generation
- reassignment
- manual hold / close transitions

#### `outreach:{id}`

Use for jobs that mutate one outreach lifecycle.

Examples:

- cold draft generation for one outreach
- follow-up draft creation
- approval/send-adjacent state mutation

### Primary-key rule

For MVP a job should have one primary `concurrency_key`, not multiple locks.

If a job touches several domains, choose the dominant conflict domain.

Examples:

- if a thread is already known, prefer `thread:{id}`
- if no thread exists yet but one organization is known, prefer `organization:{id}`

### What does not need strict concurrency keys

Some jobs may run without conflict serialization:

- embeddings
- replace-safe summaries
- non-critical metrics recompute
- digest assembly

### Important boundary

`concurrency_key` complements database constraints. It does not replace them.

Database invariants are still required for:

- one active thread per company
- send idempotency
- webhook dedupe identities

## 36. Worker Pools Inside One Runtime

MVP should use one worker runtime/container but not one flat undifferentiated queue runner.

The system should keep:

- one shared `jobs` table
- one worker runtime
- several logical worker pools inside that runtime

### Why a single flat runner is not enough

Without pool separation:

- heavy LLM or enrichment work can starve urgent reply handling
- embeddings can consume slots while operator-facing jobs wait
- low-priority maintenance can compete with user-visible flows

### Why multiple separate services are too early

Splitting into many separate worker services would add operational overhead too early:

- more deploy units
- more config
- more local compose complexity
- more moving parts for MVP

### Recommended model

Use one worker runtime with several internal poll loops or execution pools.

Each pool:

- filters on a subset of job types
- has its own concurrency limit
- may have its own polling cadence

### Recommended scheduling approach

Keep one `jobs` table, but give jobs an explicit `worker_pool`.

Examples:

- `urgent`
- `drafting`
- `background`

This is clearer than relying only on `job_type` inference.

### Result

This protects urgent flows from starvation without introducing many separate services.

## 37. MVP Worker Pools

MVP should use exactly three worker pools:

- `urgent`
- `drafting`
- `background`

### `urgent`

Latency-sensitive and operator-visible work.

Recommended job types:

- `job.process_webhook_event`
- `job.process_provider_event`
- `job.match_thread`
- `job.classify_reply`
- `job.generate_warm_draft`
- `job.send_email`
- `job.send_telegram_notification`

### `drafting`

Campaign expansion and cold-outreach preparation.

Recommended job types:

- `job.enrich_organization`
- `job.refresh_research_snapshot`
- `job.select_primary_contact`
- `job.generate_cold_draft`
- campaign discovery / expansion jobs
- follow-up draft generation

### `background`

Low-priority compute and maintenance.

Recommended job types:

- `job.call_embedding_provider`
- `job.index_rag_document`
- `job.refresh_thread_summary`
- `job.recompute_work_items`
- `job.recompute_scores`
- `job.resurface_deferred_items`
- `job.send_digest`

### Important rule

Pool choice depends on workflow context, not only on low-level API type.

Examples:

- LLM calls used to generate a warm reply belong to `urgent`
- LLM calls used to generate a cold draft belong to `drafting`
- embedding calls belong to `background`

### Scheduling priority

- `urgent` = highest
- `drafting` = medium
- `background` = lowest

`urgent` must always retain reserved capacity so reply handling and send operations do not wait behind heavy background compute.

## 38. External Agent Framework Boundary

MVP should not use an external agent framework as the system orchestration backbone.

The backbone remains:

- commands
- jobs
- job_runs
- event_log
- worker pools
- typed stage services

### What this means

- no LangChain as the core runtime backbone
- no Vertex Agent Builder as the runtime backbone
- no external framework should own retries, idempotency, worker scheduling, or domain state transitions

### What is allowed later

Bounded agent frameworks may be used inside specific stage services if they help with internal agentic subflows.

Examples:

- a stage-local multi-step reasoning subflow
- a bounded tool-using research subflow
- a typed draft-generation subflow with internal planner/worker logic

### Stage-level framework choice

The stage-level agent framework decision is no longer deferred.

ADK is selected for worker-agent workflows inside bounded stage services.

LangGraph or plain typed services remain fallback options only if ADK proves unsuitable during implementation.

Any fallback would still be stage-local and would not replace the top-level Postgres-backed system orchestrator.

## 39. Agentic vs Deterministic Stage Services

Not every stage should be agentic.

### Deterministic stages

These stages must remain predictable, policy-safe, and schema-driven:

- webhook ingress persistence
- webhook dedupe
- provider event application
- send guardrails and policy checks
- headers-first thread matching path
- suppression and cooldown transitions
- work-item materialization
- command/job/event persistence
- delivery state updates
- one-active-thread enforcement
- idempotency checks

### Agentic stages

These stages may use LLM-driven reasoning or synthesis, but only inside bounded service contracts:

- campaign discovery / prospect discovery
- organization research synthesis
- contact selection ranking
- cold draft generation
- reply classification
- warm draft generation
- thread summary generation

### Recommended MVP stage services

#### Strongly agentic

- `CampaignDiscoveryService`
- `OrganizationResearchService`
- `ColdDraftGenerationService`
- `ReplyClassificationService`
- `WarmDraftGenerationService`

#### Lightly agentic

- `ContactSelectionService`
- `ThreadSummaryService`

#### Deterministic

- `InboundProcessingService`
- `MemoryIndexingService`
- policy / send / guardrail / state-transition machinery

### Important boundary

Agentic services may perform synthesis, ranking, drafting, summarization, and bounded extraction.

Deterministic services remain responsible for:

- invariants
- side effects
- state transitions
- dedupe
- policy enforcement
- queue orchestration

## 40. ADK Worker-Agent Runtime

The project chooses `ADK` as the agent orchestration framework for worker-agent workflows.

This replaces the earlier deferred spike posture.

Terminology:

- `worker service` or `worker container` means the Dockerized process that leases and executes jobs
- `ADK agent runtime` means the stage-local agent execution adapter invoked by worker jobs

### Why ADK

The ADK research notes show that ADK provides the primitives needed for agent workflow implementation:

- `LlmAgent`
- `SequentialAgent`
- `ParallelAgent`
- `LoopAgent`
- custom agents via `BaseAgent`
- sessions and state
- event streaming
- native MCP integration
- A2A support for future cross-service agents

### Runtime choice

Use **Python ADK** for worker-agent workflows.

Reasoning:

- Python ADK v1.x is the most mature ADK runtime
- TypeScript ADK exists, but the research notes indicate non-Python SDKs have fewer examples and may lag Python functionality
- the dashboard can remain TypeScript/Next while worker-agent execution runs through a Python ADK agent runtime invoked by the worker service

### What remains outside ADK

ADK does not own:

- product truth
- command lifecycle truth
- job lifecycle truth
- event log truth
- send/delivery truth
- suppression/cooldown truth
- work item truth

Those remain in Postgres and the domain/service layer.

### What ADK owns

ADK may own:

- stage-local agent workflow execution
- stage-local temporary state
- sub-agent composition
- tool choreography inside one bounded stage
- streamed internal agent events used for observability artifacts

### Agent Engine decision

Vertex AI Agent Engine is out of MVP.

It may be reconsidered later for managed deployment, but the current system is containerized and Postgres-backed.

MVP model calls should use direct Gemini/model API access through ADK model configuration, not Vertex AI Agent Engine managed deployment.

### MCP and A2A decision

- use ADK's native MCP support for agent-to-tool integration where useful
- use ADK sub-agents for agents inside the same worker process
- defer A2A until agents cross service/team/organization boundaries

### Live API boundary

Gemini Live API is out of scope for this email-outreach worker.

Known ADK Live API lag does not affect this MVP unless the project later adds voice/video agents.

## 41. Two-Level Orchestration Split

The project has two distinct orchestration layers.

### System orchestrator

This is already decided.

It is the custom Postgres-backed worker orchestration built from:

- `commands`
- `jobs`
- `job_runs`
- `event_log`
- `worker_pool`
- `concurrency_key`
- idempotency
- command/job/event handlers

This remains the top-level runtime backbone.

### Stage-level agent orchestrator

This is decided.

Stage-level agent orchestration uses `ADK`.

This choice does not replace the system orchestrator.

## 42. ADK-First Assumption for Worker-Agent Workflows

The project now adopts an `ADK-first` assumption for worker-agent workflows.

### What this means

`ADK` is the preferred framework for implementing agentic stage workflows inside the worker.

This includes stages such as:

- campaign discovery
- organization research synthesis
- contact selection reasoning
- reply classification
- cold draft generation
- warm draft generation

### What this does not mean

`ADK` does not replace the top-level system orchestrator.

The following remain owned by the Postgres-backed runtime:

- commands
- jobs
- job_runs
- event_log
- worker pools
- concurrency keys
- idempotency
- policy state
- work items
- webhook ingestion

### Boundary rule

ADK may own stage-local workflow execution, temporary state, and tool choreography.

It must not become the primary source of truth for:

- product lifecycle state
- send/delivery truth
- suppression or cooldown truth
- inbox/work-item truth
- audit/event history truth

### Fallback status

- `LangGraph` remains a fallback only if ADK proves unsuitable in implementation
- plain deterministic services remain appropriate for non-agentic stages

## 43. ADK Stage Mapping

Agentic worker stages should map to ADK primitives explicitly.

### `CampaignDiscoveryService`

Recommended ADK shape:

- `SequentialAgent` as the outer workflow
- optional `ParallelAgent` for multiple discovery sources
- `LlmAgent` for candidate synthesis and fit rationale

Suggested sequence:

1. load campaign context
2. query configured discovery sources/tools
3. synthesize candidate organizations
4. validate candidates against campaign constraints
5. return structured discovered-organization output

### `OrganizationResearchService`

Recommended ADK shape:

- `SequentialAgent` outer workflow
- `ParallelAgent` for independent research tools
- `LlmAgent` for synthesis into verified facts, risks, and contact candidates

Suggested sequence:

1. load organization and campaign context
2. run research tools in parallel where useful
3. extract facts with sources
4. synthesize research snapshot
5. classify risks/unknowns and fact confidence

### `ContactSelectionService`

Recommended ADK shape:

- `SequentialAgent`
- optional `LlmAgent` for ranking rationale

Policy constraints remain deterministic and are applied before and after ADK reasoning.

Suggested sequence:

1. load candidate contacts and policy state
2. filter deterministic blockers
3. rank remaining contacts
4. return primary/fallback selection with rationale

### `ColdDraftGenerationService`

Recommended ADK shape:

- `SequentialAgent`
- `LlmAgent` for drafting
- optional `LoopAgent` only for bounded self-critique/rewrite if needed

Suggested sequence:

1. load campaign, organization, contact, and research context
2. retrieve positive and negative RAG memory
3. assemble prompt context
4. generate draft
5. validate against forbidden claims and structured output schema
6. return draft plus metadata

### `ReplyClassificationService`

Recommended ADK shape:

- single `LlmAgent` or short `SequentialAgent`

This stage stays tightly schema-bound.

Suggested sequence:

1. load inbound message and thread context
2. classify into the fixed reply taxonomy
3. extract structured entities such as referred contact or retry date
4. return confidence and flags

### `WarmDraftGenerationService`

Recommended ADK shape:

- `SequentialAgent`
- `LlmAgent` for reply drafting
- optional `LoopAgent` for one bounded revise pass when validation fails

Suggested sequence:

1. load latest inbound, thread summary, research snapshot, and reply class
2. retrieve similar warm replies and negative patterns
3. generate warm draft
4. validate tone, factual safety, and output schema
5. return draft plus metadata

### `ThreadSummaryService`

Recommended ADK shape:

- single `LlmAgent`

This is bounded summarization, not autonomous workflow.

### Deterministic services outside ADK

The following remain outside ADK:

- `InboundProcessingService`
- `MemoryIndexingService`
- webhook dedupe
- send guardrails
- suppression/cooldown transitions
- idempotency checks
- work-item materialization

### LoopAgent rule

`LoopAgent` is allowed only with strict limits:

- explicit max iterations
- schema validation after each iteration
- no unbounded autonomous planning loop
- final output must still be validated by the domain layer

## 44. Agent Run Bridge

Postgres jobs launch agentic stage execution through a framework-neutral agent-run layer.

ADK is the current runtime, but persistence must not be named after ADK.

### Execution flow

1. worker leases a `job`
2. worker creates a `job_run`
3. worker loads domain context from Postgres
4. worker creates an `agent_run`
5. worker invokes the current agent runtime with `runtime = adk`
6. agent runtime emits technical events and artifacts
7. worker receives structured output
8. output is schema-validated
9. deterministic domain service applies validated output in Postgres
10. worker writes domain events and completes or fails the job

### `agent_runs`

One row per agentic stage execution inside a `job_run`.

Recommended fields:

- `id`
- `job_id`
- `job_run_id`
- `stage_name`
- `runtime`
- `runtime_version`
- `runtime_session_id`
- `runtime_trace_ref` nullable
- `status`
- `input_snapshot_json`
- `output_json`
- `validation_status`
- `started_at`
- `completed_at`
- `failed_at`
- `error_message`

### `agent_run_events`

Technical event stream from the runtime.

Recommended fields:

- `id`
- `agent_run_id`
- `sequence`
- `runtime_event_type`
- `payload_json`
- `created_at`

These events are not product `event_log` entries.

### `agent_run_artifacts`

Artifacts created during agentic execution.

Recommended fields:

- `id`
- `agent_run_id`
- `artifact_type`
- `payload_json`
- `created_at`

Artifact types:

- `input_snapshot`
- `prompt_context`
- `tool_result`
- `raw_model_output`
- `validated_output`
- `validation_error`
- `retrieval_context`

### Domain commit rule

Agent output is a proposal, not a domain mutation.

ADK may produce:

- proposed research snapshot
- proposed contact ranking
- proposed reply classification
- proposed draft

Only deterministic domain services may apply validated output to domain tables.

### Retry and idempotency

Retries may create new `job_runs` and new `agent_runs`, but keep the same `job_id` and `correlation_id`.

Domain commit logic must be idempotent so repeated agent execution cannot double-create drafts, double-apply classifications, or double-write side effects.

## 45. ADK Tool Boundary and Guardrails

ADK agents must not receive unrestricted access to the database, filesystem, or external APIs.

Agents receive only typed tools with narrow contracts.

### Tool groups

#### Read-only domain tools

Examples:

- `get_campaign_context(campaign_id)`
- `get_organization_context(organization_id)`
- `get_thread_context(thread_id)`
- `get_research_snapshot(organization_id)`
- `get_feedback_memory(filters)`
- `search_rag_memory(query, filters)`

Rules:

- read-only
- normalized/sanitized snapshots only
- no secrets
- no unrestricted table dumps

#### Research tools

Examples:

- `search_web(query, constraints)`
- `fetch_url(url)`
- `extract_company_facts(content)`
- `find_contact_candidates(domain)`

Rules:

- rate-limited
- source URLs preserved
- raw results saved as artifacts
- curated facts returned through structured stage output

#### RAG tools

Examples:

- `retrieve_positive_examples(filters, query)`
- `retrieve_negative_patterns(filters, query)`
- `retrieve_feedback_patterns(filters, query)`

Rules:

- structured narrowing is required
- positive and negative corpora must not be mixed as equal examples

#### Validation tools

Examples:

- `validate_output_schema(output, schema_name)`
- `check_forbidden_claims(text, forbidden_claims)`
- `check_used_fact_refs(text, verified_facts)`
- `classify_risk_tags(draft)`

Rules:

- may return pass/fail plus reasons
- final domain commit still belongs to deterministic services

### No direct write tools in MVP

ADK agents must not receive tools such as:

- `create_draft`
- `update_thread`
- `suppress_contact`
- `send_email`
- `create_work_item`

Agent output is a structured proposal. Deterministic domain services perform writes.

### Tool allowlists

Each stage must have its own explicit tool allowlist.

Examples:

- `ReplyClassificationService` should not have web search
- `ColdDraftGenerationService` should not have email sending
- `OrganizationResearchService` may have search/fetch/extraction tools

### Tool artifact persistence

Meaningful tool calls should be stored in `agent_run_artifacts` as `tool_result`.

### Network and secret boundaries

Tools must:

- avoid returning secrets
- avoid exposing raw credentials or environment values
- cap response size
- timeout cleanly
- preserve source references for research outputs

## 46. ADK Toolsets by Stage

Each ADK-backed stage gets an explicit tool allowlist.

### `CampaignDiscoveryService`

Allowed tools:

- `get_campaign_context`
- `search_web`
- `fetch_url`
- `extract_company_facts`
- `search_rag_memory`
- `validate_output_schema`

Not allowed:

- thread tools
- send tools
- policy write tools
- draft creation tools

### `OrganizationResearchService`

Allowed tools:

- `get_campaign_context`
- `get_organization_context`
- `get_research_snapshot`
- `search_web`
- `fetch_url`
- `extract_company_facts`
- `find_contact_candidates`
- `validate_output_schema`

Not allowed:

- send tools
- suppression write tools
- direct contact/write tools

### `ContactSelectionService`

Allowed tools:

- `get_organization_context`
- `get_research_snapshot`
- `get_policy_snapshot`
- `validate_output_schema`

Optional:

- `retrieve_feedback_patterns`

Not allowed:

- web search
- URL fetch
- send tools
- direct contact update tools

### `ColdDraftGenerationService`

Allowed tools:

- `get_campaign_context`
- `get_organization_context`
- `get_research_snapshot`
- `retrieve_positive_examples`
- `retrieve_negative_patterns`
- `retrieve_feedback_patterns`
- `check_forbidden_claims`
- `check_used_fact_refs`
- `validate_output_schema`

Not allowed:

- web search by default
- send tools
- write tools

If research is insufficient, the stage should return a structured `needs_research` outcome instead of expanding research autonomously.

### `ReplyClassificationService`

Allowed tools:

- `get_thread_context`
- `get_organization_context`
- `validate_output_schema`

Optional:

- `retrieve_feedback_patterns`
- `retrieve_similar_reply_classes`

Not allowed:

- web search
- drafting tools
- send tools
- suppression write tools

### `WarmDraftGenerationService`

Allowed tools:

- `get_thread_context`
- `get_organization_context`
- `get_research_snapshot`
- `retrieve_positive_examples`
- `retrieve_negative_patterns`
- `retrieve_feedback_patterns`
- `check_forbidden_claims`
- `check_used_fact_refs`
- `validate_output_schema`

Not allowed:

- send tools
- policy write tools
- broad web search

### `ThreadSummaryService`

Allowed tools:

- `get_thread_context`
- `validate_output_schema`

Optional:

- `get_organization_context`

Not allowed:

- web search
- send tools
- write tools

### `MemoryIndexingService`

This remains deterministic and should not run as an ADK agent.

Embeddings should be produced by deterministic embedding jobs/services.

### Global rules

- web search is allowed only in discovery and research stages
- write/send tools are not allowed in ADK agents in MVP
- policy/suppression mutation is not allowed in ADK agents in MVP

## 47. External Source Tooling Model

ADK provides the tool orchestration layer. It does not magically provide every external data source.

### Built-in / native fit

General web search can be handled through Gemini Google Search grounding / ADK Google Search tooling where available.

This is suitable for broad public web discovery and current-source lookup.

### Custom or MCP tools

Sources such as Twitter/X, Reddit, GitHub, Discord, Crunchbase, and other domain-specific providers should be integrated as explicit tools.

Implementation options:

- custom typed ADK tools
- MCP toolsets
- third-party source/search APIs
- source-specific API clients

### Required properties for external source tools

Every external source tool must have:

- typed input contract
- typed output contract
- auth boundary
- rate limits
- timeout
- response-size cap
- source attribution
- artifact persistence in `agent_run_artifacts`
- stage-specific allowlist

### Important boundary

Agents do not receive unrestricted browser-like access.

They call allowlisted source tools.

Tool results become artifacts. Curated facts must still pass validation before domain commit.

### Examples

- `search_web(query, constraints)` may use Gemini Google Search grounding
- `search_reddit(query, constraints)` uses Reddit API, third-party provider, or MCP server
- `search_x_posts(query, constraints)` uses X API, third-party provider, or MCP server
- `fetch_github_org(identifier)` uses GitHub API or MCP server

### MVP recommendation

Start with:

- Google Search/web tooling
- site fetch/extract
- RAG retrieval

Add Reddit/X/source-specific tools only when a stage actually needs them.

## 48. ADK Model and Provider Policy

Model selection must be deterministic.

Agents must not choose their own model.

### Default provider

Because ADK is the worker-agent runtime, the MVP default provider is:

- provider: `google`
- model family: Gemini

### `ModelPolicyResolver`

Use a deterministic `ModelPolicyResolver` that resolves model policy from `stage_name`.

Recommended resolved fields:

- `provider`
- `model`
- `temperature`
- `max_output_tokens`
- `timeout_seconds`
- `structured_output`
- `repair_allowed`
- `fallback_provider` nullable
- `fallback_model` nullable

### Stage policy defaults

#### Reply classification

- fast/cheap Gemini model
- low temperature
- structured output required
- low/medium output budget

#### Draft generation

- stronger Gemini model
- medium-low temperature
- structured output required
- medium/high output budget

#### Organization research synthesis

- stronger Gemini model or same tier as drafting
- low temperature
- structured output required
- medium/high output budget

#### Campaign discovery

- medium/strong Gemini model
- medium temperature
- structured output required

#### Thread summary

- fast/cheap Gemini model
- low temperature
- structured output required

### Fallback providers

ADK may support non-Gemini models through LiteLLM/OpenAI-compatible endpoints.

Fallback must be:

- explicit
- stage-configured
- persisted in artifacts
- used only for provider/runtime availability failures

Fallback must not be used for:

- safety validation failures
- bad facts
- policy blockers
- invalid input context

### Persistence

The resolved model policy must be stored in `input_snapshot_json.model_policy` for every `agent_run`.

This preserves explainability when model configuration changes later.

## 49. Stage-Level Model Policy Profiles

Stages should reference model policy profiles, not hardcoded model names.

### Recommended profiles

- `classification_fast`
- `summary_fast`
- `research_strong`
- `discovery_strong`
- `drafting_strong`
- `repair_fast`

### Stage defaults

#### `ReplyClassificationService`

- profile: `classification_fast`
- temperature: low
- structured output required
- repair allowed for schema only

#### `ThreadSummaryService`

- profile: `summary_fast`
- temperature: low
- structured output required
- repair allowed for formatting only

#### `OrganizationResearchService`

- profile: `research_strong`
- temperature: low/medium
- structured output required
- web/search tools allowed
- repair allowed for schema only

#### `CampaignDiscoveryService`

- profile: `discovery_strong`
- temperature: medium
- structured output required
- search tools allowed

#### `ContactSelectionService`

- profile: `classification_fast`
- deterministic policy filters run before and after ADK ranking

#### `ColdDraftGenerationService`

- profile: `drafting_strong`
- temperature: medium-low
- structured output required
- bounded repair allowed

#### `WarmDraftGenerationService`

- profile: `drafting_strong`
- temperature: medium-low
- structured output required
- bounded repair allowed

### Env-backed model names

Model names should be resolved from config/env rather than hardcoded in stage code.

Suggested env names:

- `ADK_MODEL_CLASSIFICATION_FAST`
- `ADK_MODEL_SUMMARY_FAST`
- `ADK_MODEL_RESEARCH_STRONG`
- `ADK_MODEL_DISCOVERY_STRONG`
- `ADK_MODEL_DRAFTING_STRONG`
- `ADK_MODEL_REPAIR_FAST`

### Persistence

Every `agent_run` stores both:

- profile name
- resolved model policy values

inside `input_snapshot_json.model_policy`.

## 50. Prompt, Schema, Rule, and Retrieval Versioning

Every input that materially affects agent output must be versioned.

This includes:

- prompt templates
- output schemas
- validation rules
- model policy
- retrieval policy

### Prompt templates

Prompt templates should be versioned repo files.

Example keys:

- `reply_classification:v1`
- `cold_draft_generation:v1`
- `organization_research:v1`

Suggested paths:

- `worker/prompts/reply_classification/v1.md`
- `worker/prompts/cold_draft_generation/v1.md`
- `worker/prompts/organization_research/v1.md`

Each prompt should have:

- `prompt_key`
- `version`
- `stage_name`
- `template_path`
- `checksum`
- git commit ref if available

### Prompt artifacts

For each `agent_run`, store:

- prompt template key
- prompt template version
- prompt template checksum
- rendered prompt or message set where reasonable

Use `agent_run_artifacts` with `artifact_type = prompt_context`.

### Output schemas

Output schemas must be versioned.

Examples:

- `reply_classification_output_v1`
- `cold_draft_output_v1`
- `organization_research_output_v1`

Store in `input_snapshot_json`:

- `output_schema_name`
- `output_schema_version`

Store in `output_json.validation`:

- `validator_version`
- `schema_version`

### Validation rules

Validation rules must be identifiable by id and version.

Examples:

- `draft_fact_ref_policy:v1`
- `forbidden_claims_policy:v1`
- `reply_class_taxonomy:v1`
- `contact_selection_policy:v1`

Store rule ids, versions, and stage parameters in `input_snapshot_json.validation_rules`.

### Retrieval policy

If RAG influences output, record retrieval policy.

Store:

- retrieval policy name/version
- filters
- top_k
- corpus types
- ranking policy or weights if used
- retrieved document ids

Large retrieved content should live in artifacts or source tables and be referenced from the snapshot.

## 51. Prompt/Schema/Rule Registry Location

For MVP, registry source of truth should live in repo/config, not Postgres registry tables.

### Source of truth

- prompt templates: repo files
- output schemas: repo files or versioned code models
- validation rules: code/config
- retrieval policies: code/config

### Postgres responsibility

Postgres stores what was used for each run:

- prompt key/version/checksum
- rendered prompt artifact
- output schema name/version/checksum
- validation rule ids/versions
- retrieval policy name/version
- resolved model policy

Postgres does not need to own the primary prompt/schema/rule registry in MVP.

### Suggested prompt layout

```text
worker/prompts/
  reply_classification/v1.md
  cold_draft_generation/v1.md
  warm_draft_generation/v1.md
  organization_research/v1.md
  campaign_discovery/v1.md
```

### Suggested schema layout

```text
worker/schemas/
  reply_classification_output_v1.json
  cold_draft_output_v1.json
  warm_draft_output_v1.json
  organization_research_output_v1.json
```

If schemas are generated from typed models such as Pydantic models, the schema/model name must still be versioned.

### Suggested validation/retrieval layout

```text
worker/validation/
  draft_fact_ref_policy.py
  reply_class_taxonomy.py
  forbidden_claims_policy.py

worker/retrieval/
  policies.py
```

### When Postgres registry may be needed later

Add DB-backed registry later only if the product needs:

- dashboard prompt editing
- A/B prompt tests
- hot prompt deployment
- per-campaign prompt overrides
- prompt approval workflow

## 52. Campaign Guidance in ADK Prompts

Campaign intent must materially shape discovery, research, drafting, and retrieval.

### `campaign_context`

All campaign-derived stages should receive a materialized `campaign_context`.

Minimum fields:

- `campaign_id`
- `name`
- `pillar`
- `objective`
- `offer_summary`
- `desired_cta`
- `target_segments`
- `include_constraints`
- `exclude_constraints`
- `operator_notes`
- `positioning_notes`
- `forbidden_claims`
- `tone_preferences` optional
- `priority`
- `policy_profile`

The object is stored in `input_snapshot_json.input_context`.

### Prompt assembly rule

Prompt templates do not read from the database.

Domain services assemble materialized context first.

The agent adapter renders prompts/messages from:

- prompt template
- campaign context
- stage-specific context
- retrieved memory refs
- validation/rule metadata

### Stage usage

#### `CampaignDiscoveryService`

Uses campaign context as primary input for objective, target segments, include/exclude constraints, and operator notes.

#### `OrganizationResearchService`

Uses campaign context to decide which facts, sources, and contact types are relevant.

#### `ContactSelectionService`

Uses objective, target segment, role relevance, exclusions, and policy profile.

#### `ColdDraftGenerationService`

Uses offer summary, desired CTA, positioning notes, forbidden claims, tone preferences, and verified facts.

#### `WarmDraftGenerationService`

Uses campaign context for positioning continuity, but current thread context has priority.

#### `ReplyClassificationService`

Uses campaign context only as secondary context for conversation purpose.

### Forbidden claims

`forbidden_claims` must be used in two places:

- prompt guidance
- validation via `check_forbidden_claims`

The prompt should instruct the agent. Validation must enforce the constraint.

### Guidance hierarchy

- `forbidden_claims` = hard constraints
- `desired_cta` = output objective
- `positioning_notes` = preferred framing
- `operator_notes` = background guidance

### RAG conditioning

Campaign context should influence retrieval filters:

- pillar
- segment
- offer type
- contact type
- reply class for warm flows

Retrieval should not be based on free-text similarity alone.

## 53. RAG Usage Inside ADK Stages

RAG may be used before ADK execution or through ADK tools during execution.

The default path is pre-retrieval before prompt assembly.

### Default: pre-retrieval before ADK run

Use deterministic retrieval before launching ADK for most stages.

Benefits:

- retrieval policy is captured in snapshot
- easier debugging
- better positive/negative corpus control
- easier top-k limits
- higher prompt reproducibility

Default for:

- `ColdDraftGenerationService`
- `WarmDraftGenerationService`
- `ReplyClassificationService`
- `ThreadSummaryService` if memory is needed

### ADK RAG tool calls during run

Allowed only in bounded cases.

Useful for:

- `CampaignDiscoveryService`
- `OrganizationResearchService`
- narrow fallback cases in `ColdDraftGenerationService`

Guardrails:

- max calls per run
- structured filters required
- no broad vector search without filters
- tool output stored as artifact
- returned document ids stored in artifacts or output metadata

### Drafting rules

For cold drafting:

- pre-retrieve positive examples
- pre-retrieve negative patterns
- pre-retrieve feedback patterns
- ADK runtime RAG lookup disabled by default

For warm drafting:

- pre-retrieve similar warm replies
- pre-retrieve similar reply classes
- pre-retrieve negative patterns
- ADK runtime RAG lookup disabled by default

### Research/discovery rules

Campaign discovery may use RAG tools to retrieve:

- similar past campaigns
- relevant positioning/examples

Organization research may use RAG tools to retrieve:

- prior research on same/similar organizations
- known patterns for similar segments

RAG is memory, not fact authority.

### Retrieval persistence

Every retrieval records:

- retrieval policy name/version
- filters
- query
- corpus type
- top_k
- returned `rag_document_id`s
- ranking scores if available

Pre-retrieval data goes into `input_snapshot_json`.

Runtime retrieval tool output goes into `agent_run_artifacts`.

### Corpus separation

Positive and negative corpora must remain labeled separately.

Rejected drafts may inform anti-patterns, but must not be presented as examples to imitate.

## 54. Web and Source Tool Budgets

Research and discovery stages must not browse without limits.

Any `agent_run` with web/source tools needs an explicit source budget.

### Budget fields

Recommended fields:

- `max_search_queries`
- `max_fetches`
- `max_source_domains`
- `max_runtime_seconds`
- `max_content_chars_per_fetch`
- `allowed_domains` optional
- `blocked_domains` optional

Example for `OrganizationResearchService`:

- `max_search_queries`: 3
- `max_fetches`: 8
- `max_runtime_seconds`: 120
- `max_content_chars_per_fetch`: 30000

### Tool call ledger

Every meaningful source tool call should be persisted as an artifact.

Minimum fields:

- tool name
- input
- output summary
- source refs
- token/content size
- latency
- success/failure

### Hard stop behavior

When budget is exhausted:

- tool returns `budget_exhausted`
- agent produces best-effort structured output
- if evidence is insufficient, outcome becomes `needs_research` or `needs_review`

### Search vs fetch

Keep search and fetch as separate tools.

- `search_web` returns candidate sources
- `fetch_url` retrieves selected content

This makes fetch limits enforceable and preserves source refs.

### Source quality tags

Research outputs should classify source quality:

- `official_site`
- `docs`
- `github`
- `social`
- `third_party_database`
- `news`
- `forum`
- `unknown`

These tags feed fact confidence.

### Source tool stage limits

Web/source tools are allowed by default only in:

- `CampaignDiscoveryService`
- `OrganizationResearchService`

Drafting and classification stages should return `needs_research`, not start broad browsing.

## 55. Source Evidence to Verified Facts

Research agents do not decide final truth.

They propose facts with evidence. Deterministic validators decide which facts become verified.

### Evidence record

Each extracted fact must reference evidence.

Minimum evidence fields:

- `source_url`
- `source_title`
- `source_type`
- `retrieved_at`
- `quoted_or_extracted_text`
- `tool_call_artifact_id`
- `confidence_hint`
- `source_quality`

Allowed source types:

- `official_site`
- `docs`
- `github`
- `social`
- `third_party_database`
- `news`
- `forum`
- `unknown`

### Proposed facts

ADK research output should contain `proposed_facts[]`, not final `verified_facts[]`.

Each proposed fact should include:

- `fact_key`
- `fact_text`
- `evidence_refs[]`
- `source_quality`
- `agent_confidence`
- `safe_for_copy_proposed`
- `rationale`

### Deterministic fact validation

After ADK output:

- schema validate
- confirm evidence refs exist
- validate source types
- clamp confidence ranges
- check duplicates/contradictions where possible
- apply source-quality weighting

Only then does the domain layer write final facts.

### Fact statuses

Facts may become:

- `verified`
- `low_confidence`
- `conflicting`
- `rejected`
- `needs_review`

### Safe for copy

ADK may propose `safe_for_copy_proposed`.

The deterministic validator decides final `safe_for_copy`.

### Final confidence

Final fact confidence is rule-based and considers:

- source quality
- number of independent sources
- recency
- contradiction
- specificity
- extraction confidence

Raw agent confidence is only one input.

## 56. Research Facts and Evidence Data Model

Research should be modeled with first-class tables, not only a large JSON blob.

### `research_snapshots`

One snapshot represents one research pass for an organization in a campaign/outreach context.

Recommended fields:

- `id`
- `organization_id`
- `campaign_id` nullable
- `outreach_id` nullable
- `agent_run_id` nullable
- `snapshot_version`
- `status`
- `summary`
- `fact_confidence_score`
- `contact_fit_overview`
- `risks_unknowns_json`
- `created_at`
- `superseded_at` nullable

Statuses:

- `active`
- `superseded`
- `failed`
- `partial`

### `research_facts`

One row per atomic claim.

Recommended fields:

- `id`
- `research_snapshot_id`
- `organization_id`
- `fact_key`
- `fact_text`
- `status`
- `confidence`
- `safe_for_copy`
- `source_quality`
- `validator_version`
- `agent_confidence` nullable
- `rationale`
- `created_at`

Statuses:

- `verified`
- `low_confidence`
- `conflicting`
- `rejected`
- `needs_review`

### `research_evidence`

One row per source/evidence artifact.

Recommended fields:

- `id`
- `research_snapshot_id`
- `organization_id`
- `source_url`
- `source_title`
- `source_type`
- `retrieved_at`
- `quoted_or_extracted_text`
- `tool_call_artifact_id` nullable
- `confidence_hint`
- `source_quality`
- `created_at`

### `research_fact_evidence`

Many-to-many link table:

- `research_fact_id`
- `research_evidence_id`

This supports:

- multiple sources for one fact
- one source supporting multiple facts

### `research_contact_candidates`

Research-discovered contacts should be proposed before they become domain `contacts`.

Recommended fields:

- `id`
- `research_snapshot_id`
- `organization_id`
- `email`
- `name`
- `role`
- `source`
- `source_evidence_id` nullable
- `contact_fit`
- `confidence`
- `rationale`
- `status`
- `created_at`

Statuses:

- `proposed`
- `accepted`
- `rejected`
- `needs_review`

### Versioning rule

Research snapshots are versioned.

Drafts should reference the `research_snapshot_id` used during generation.

Claims used in drafts should reference specific `research_fact_id`s.

### `draft_claim_fact_refs`

The system should support a link table:

- `draft_claim_id`
- `research_fact_id`

This supports validation, UI explanation, and safe-copy review.

## 57. Draft Used-Fact Validation

Draft generation must explicitly connect factual claims to verified facts.

### Draft output contract

`ColdDraftGenerationService` and `WarmDraftGenerationService` should return:

- `draft_subject`
- `draft_body`
- `used_fact_refs[]`
- `unsupported_claims[]`
- `soft_claims[]`
- `draft_rationale`
- `needs_research_reason` nullable

### `used_fact_refs[]`

Each reference should include:

- `research_fact_id`
- `claim_text`
- `draft_span` optional
- `usage_type`

Allowed `usage_type` values:

- `direct_claim`
- `contextual_reference`
- `personalization`
- `cta_support`

### `unsupported_claims[]`

If the draft uses a claim that cannot map to a verified safe fact, the agent should flag it.

Fields:

- `claim_text`
- `reason`
- `suggested_action`

Allowed suggested actions:

- `remove_claim`
- `needs_research`
- `downgrade_to_generic`
- `manual_review`

### Validator behavior

After draft output:

- verify every `used_fact_ref` exists
- verify referenced fact belongs to the same organization/research snapshot
- verify `research_facts.status = verified`
- verify `safe_for_copy = true`
- verify forbidden claims are absent
- inspect unsupported claims

### Unsupported claim handling

- minor unsupported claims may get one bounded repair pass
- central unsupported claims produce `needs_research`
- hidden unsupported claims should be detected where possible through claim checking and review flags

### `draft_claim_fact_refs`

When draft validation passes, create `draft_claim_fact_refs` rows:

- `draft_claim_id`
- `research_fact_id`
- `support_type`
- `created_at`

### Soft claims

Generic value proposition and CTA language may be `soft_claims` and need not reference research facts.

Company-specific facts, metrics, integrations, technical claims, or product claims require verified safe facts.

## 58. Claim Classification for Draft Validation

Draft validation must distinguish generic offer language from company-specific factual claims.

### Generic value proposition

Generic offer claims describe our services or general business value.

Examples:

- "We help teams automate internal workflows"
- "We build AI integrations for operations and support"
- "Could be useful if you are exploring AI-assisted processes"
- "Happy to share a few examples"
- "Would a short intro call make sense?"

These do not require `research_fact_id`, but they must still obey campaign offer and forbidden-claims rules.

### Company-specific factual claims

Claims about the recipient, organization, product, technical stack, metric, launch, hiring, or market position require verified safe facts.

Examples:

- "You are using Cosmos SDK"
- "Your docs mention a validator program"
- "You recently launched mainnet"
- "Your team is hiring AI engineers"
- "Your protocol has $12M TVL"
- "You support Solana integrations"

### Soft personalization

Soft personalization can still be company-specific.

Examples:

- "Saw your work around validator tooling"
- "Noticed your ecosystem focus"
- "Your docs suggest you care about developer onboarding"

If tied to a specific company observation, it requires a fact reference.

### Claim categories

Validator should classify spans as:

- `generic_offer_claim`
- `company_specific_fact`
- `metric_claim`
- `technical_claim`
- `market_claim`
- `soft_personalization`
- `cta`
- `unsupported_or_unclear`

### Validation rules

No fact ref required:

- `generic_offer_claim`
- `cta`

Fact ref required:

- `company_specific_fact`
- `metric_claim`
- `technical_claim`
- `market_claim`
- `soft_personalization` tied to company-specific observation

Review or repair:

- `unsupported_or_unclear`

### MVP validator approach

Use layered validation:

1. agent self-report through `used_fact_refs`, `soft_claims`, and `unsupported_claims`
2. deterministic heuristics for company names, metrics, technical terms, and phrases like "your docs", "your website", "you recently", "noticed that", "saw that"
3. optional LLM claim classifier as advisory only

If uncertain, route to `needs_review`.

## 59. Draft Claim Support Data Model

Draft claim validation needs first-class storage so the dashboard can explain draft safety.

### `draft_claims`

One row per claim span or logical claim in a draft.

Recommended fields:

- `id`
- `draft_id`
- `claim_text`
- `claim_category`
- `validation_status`
- `confidence`
- `span_start` nullable
- `span_end` nullable
- `requires_fact_ref`
- `created_at`

Allowed `claim_category` values:

- `generic_offer_claim`
- `company_specific_fact`
- `metric_claim`
- `technical_claim`
- `market_claim`
- `soft_personalization`
- `cta`
- `unsupported_or_unclear`

Allowed `validation_status` values:

- `supported`
- `unsupported`
- `soft`
- `needs_review`
- `rejected`
- `not_required`

### `draft_claim_fact_refs`

Canonical join table between claims and facts.

Recommended fields:

- `draft_claim_id`
- `research_fact_id`
- `support_type`

Allowed `support_type` values:

- `direct_support`
- `contextual_support`
- `weak_support`

### Canonical model

`draft_claim_fact_refs` is the canonical fact-support model for drafts.

Older draft-level fact reference tables are not required in MVP and should not be created unless added by a later compatibility decision.

### UI usage

The dashboard can show for each claim:

- claim text
- validation status
- supporting facts
- evidence/source links
- weak or unsupported warning

### Versioning

Draft claim validation belongs to a draft version.

If repair creates a new draft version, the old version keeps its original claims and validation results.

## 60. Draft Review Panel Claim Safety UI

Draft claim validation must be visible to the operator at review time.

It is not enough to validate claims internally; the dashboard must explain why a draft is safe, weak, or blocked.

### Claim Safety summary

The Active Review Panel shows a compact `Claim Safety` block for the current draft version.

Allowed summary states:

- `all_supported`
- `unsupported_claims`
- `needs_research`
- `needs_review`
- `weak_support`

The summary is derived from `draft_claims` and `draft_claim_fact_refs`, not from raw agent text.

### Inline and expandable UI

The default editor should not become noisy.

Show:

- one top-level safety badge near the draft actions
- inline claim indicators only for risky or weak claims
- an expandable claim map with all claims and supporting facts

Generic offer claims and CTA claims should not create visible noise unless they were classified as unclear or unsafe.

### Claim details

For each claim, the operator can inspect:

- claim text
- claim category
- validation status
- confidence
- support type
- supporting facts
- evidence/source links
- whether supporting facts are `safe_for_copy`

Clicking a supported claim opens the related facts and evidence in the research/source panel.

### Approve/send gating

`Approve and Send` is blocked when the draft contains unsupported central claims in these categories:

- `company_specific_fact`
- `metric_claim`
- `technical_claim`
- `market_claim`

The operator must resolve the issue by removing the claim, editing the draft, or running more research.

`weak_support` does not hard-block by default, but requires an explicit confirmation or edit.

`needs_review` blocks approval until the operator opens and inspects the single draft.

### Operator actions

The review panel exposes actions for risky claims:

- `Research More`
- `Edit Manually`
- `Revise with AI`
- `Remove Claim`
- `Open Sources`

`Research More` creates a bounded research command for the specific organization, campaign, and unsupported claim context.

`Revise with AI` passes validation errors and unsupported claim metadata into the next draft-generation attempt.

### Versioning

Claim safety belongs to the current draft version.

If the operator edits or AI revises a draft, the new draft version receives new claim validation rows.

The old version remains explainable for audit and learning.

## 61. Draft Review Panel Command Semantics

Draft Review Panel actions must map cleanly into the command/job/event model.

The UI does not mutate business state directly.

### Action matrix

`Research More`:

- creates `request_research_more`
- enqueue-only
- payload includes `campaign_id`, `organization_id`, optional `draft_id`, unsupported claim ids, claim text, current research snapshot id, and operator note
- handler enqueues bounded organization research work
- worker may produce a new research snapshot and then request a new draft or mark research insufficient

`Revise with AI`:

- creates `request_ai_revise`
- enqueue-only
- payload includes `draft_id`, `thread_id`, `campaign_id`, validation errors, unsupported claim metadata, operator instruction, and selected source/fact context
- handler enqueues draft revision work
- worker creates a new draft version, not an in-place mutation

`Edit Manually`:

- entering edit mode is UI-local and does not create a command
- saving creates `request_manual_edit_save`
- immediate-transition command when the payload contains the new draft body
- creates a new operator-edited draft version
- triggers claim revalidation before the draft can be approved

`Remove Claim`:

- creates `request_manual_edit_save`
- immediate-transition command when the UI submits the edited draft body with the claim removed
- creates a new draft version
- triggers claim revalidation

`Open Sources`:

- read-only UI action
- does not create a command
- may emit an audit/event-log entry later if operator source inspection becomes product-relevant, but it is not part of MVP command flow

### Idempotency keys

State-changing review actions require operator-command idempotency.

Recommended idempotency scopes:

- `request_research_more`: operator id + draft id + claim ids + normalized operator note hash
- `request_ai_revise`: operator id + draft id + normalized instruction hash + validation version
- `request_manual_edit_save`: operator id + previous draft version id + edited body hash
- `approve_draft_for_send`: operator id + draft version id + recipient id

### Events

Immediate command handlers may append intent events such as:

- `draft_research_more_requested`
- `draft_revision_requested`
- `draft_manual_edit_saved`
- `draft_claim_removed_by_operator`

Worker completion emits result events such as:

- `research_snapshot_refreshed`
- `draft_revised`
- `draft_claims_revalidated`

`draft_revised` must never be emitted by the command handler before worker execution finishes.

### Approval interaction

`approve_draft_for_send` must check the latest claim safety state for the exact draft version being approved.

If claim validation is stale or missing for that version, approval is blocked and revalidation is requested.

Approval must not silently approve an older safe version while the UI is showing a newer unsafe version.

## 62. Approve and Send Pipeline

`Approve and Send` is operator-controlled, but the send itself is executed by the worker.

The operator decision and the external email side effect are separate facts.

### Command handler

The dashboard creates `approve_draft_for_send`.

The command handler must:

- enforce operator-command idempotency
- verify the draft version is still current and sendable
- verify claim safety for the exact draft version
- run lightweight pre-send guardrail checks that can be evaluated synchronously
- mark the draft as `approved_for_send` or `send_requested`
- create or reserve an `outbound_message` record in `send_requested` state
- append `draft_approved_for_send`
- enqueue `job.send_email`

The command handler must not call Resend.

### Required pre-send checks

Before enqueueing send work, the system checks:

- suppression and do-not-contact state
- pending unprocessed suppression-class webhook events for the same recipient
- contact and recipient validity
- one-active-thread / duplicate-send constraints
- thread ambiguity and reassignment state
- latest draft version identity
- claim safety for the exact draft version
- policy state such as cooldown, manual hold, compliance flag, and retry-after
- idempotency conflicts for the same draft version and recipient

Hard-block failures prevent send enqueueing and create operator-visible feedback.

Warnings may require explicit operator confirmation before the command is accepted.

Timing is advisory unless a specific policy state makes it a hard block.

If a pending `webhook_events` row for the recipient may represent complaint, hard bounce, or unsubscribe, approval and send must block until that event is processed or explicitly reconciled.

### `outbound_messages`

`outbound_messages` is the durable send-intent and send-result record.

Recommended fields:

- `id`
- `draft_id`
- `draft_version`
- `thread_id`
- `campaign_id`
- `organization_id`
- `contact_id`
- `recipient_email`
- `provider`
- `provider_message_id` nullable
- `status`
- `idempotency_key`
- `payload_snapshot_json`
- `approved_by_operator_id`
- `approved_at`
- `send_attempted_at`
- `sent_at`
- `failed_at`
- `failure_class` nullable
- `failure_message` nullable
- `created_at`
- `updated_at`

Allowed status values:

- `send_requested`
- `sending`
- `sent`
- `send_failed`
- `send_ambiguous`
- `delivery_delivered`
- `delivery_bounced`
- `complained`
- `suppressed_after_send`

### Send job

`job.send_email` must:

- lease the reserved `outbound_message`
- re-run final hard guardrails inside the worker transaction before the external call
- build a stable Resend payload from the stored draft version and recipient
- use a stable provider idempotency key
- persist `payload_snapshot_json` before the provider call
- mark the row `sending`
- call Resend
- persist `provider_message_id` on confirmed success
- mark the row `sent`
- append `outbound_sent`

The send job must not regenerate or modify draft content.

### Ambiguous send result

If the worker cannot determine whether Resend accepted the email, it must not blindly retry.

Examples:

- network timeout after request body was sent
- connection reset without a reliable provider response
- provider response parse failure after possible acceptance

In these cases:

- mark `outbound_messages.status = send_ambiguous`
- append `outbound_send_ambiguous`
- create an operator-visible work item
- attempt bounded reconciliation using provider idempotency key or provider events if available

Only clearly safe, provider-confirmed non-acceptance can be retried.

### Provider events

Resend delivery/provider webhooks update the existing `outbound_message` by provider id or stable metadata.

Provider events may move status from:

- `sent` to `delivery_delivered`
- `sent` or `delivery_delivered` to `delivery_bounced`
- any post-send state to `complained`

Complaint and hard bounce events also create suppression state immediately.

Provider webhook processing must be idempotent and append business events only once per provider event.

### Thread timeline

After confirmed send, the timeline shows:

- operator approval
- send attempt
- confirmed sent state
- later delivery/bounce/complaint events

Approval alone is not displayed as a sent email.

## 63. Resend Webhook Processing Pipeline

Resend webhooks are external facts, not direct domain mutations.

Every webhook must first become a durable `webhook_events` row, then be processed by the worker.

### Endpoint split

MVP supports two logical webhook surfaces:

- inbound email events
- provider delivery/status events

They may be implemented as separate route handlers or one route handler with event-type routing.

Regardless of route shape, both use the same ingress contract:

- verify Resend signature/authenticity
- persist raw headers and body
- compute provider dedupe key
- mark duplicate events safely
- enqueue `job.process_webhook_event`
- return fast success

The route handler must not perform thread matching, reply classification, final delivery state transitions, notifications, work item routing, or heavy domain interpretation inline.

Safety exception: after signature verification and dedupe, the ingress route may perform a minimal deterministic suppression fast-path for explicit complaint, hard bounce, and unsubscribe events. This exception exists only to close the approve/send race where a suppression-class webhook is durable but not yet processed by the worker. The fast-path must be idempotent, must not call external services, must not match threads or mutate delivery state, and the worker still owns full provider-event interpretation, reconciliation, notifications, and work-item creation.

### `webhook_events`

`webhook_events` is the source of truth for provider event ingestion.

Recommended fields:

- `id`
- `provider`
- `event_type`
- `provider_event_id` nullable
- `provider_message_id` nullable
- `dedupe_key`
- `raw_headers_json`
- `raw_body_json`
- `received_at`
- `status`
- `processed_at` nullable
- `processing_error` nullable
- `correlation_id`

Allowed status values:

- `received`
- `duplicate_ignored`
- `queued_for_processing`
- `processing`
- `processed`
- `processing_failed`
- `dead_lettered`

### Dedupe keys

Dedupe must be stable across provider retries.

Preferred dedupe key order:

1. provider event id if Resend supplies one
2. provider message id + event type + provider event timestamp
3. hash of canonicalized raw body when no better identity exists

Duplicate webhook events must not create duplicate business events, duplicate inbound messages, duplicate suppression entries, or duplicate delivery updates.

### Inbound email processing

For inbound email events, the worker must:

- parse the normalized inbound message
- persist `inbound_messages` with raw/parsed content refs
- persist attachment metadata if present
- resolve or create thread participant records
- attempt thread match
- create `thread_match_ambiguous` and manual triage work item if matching is uncertain
- classify reply only after a thread is matched or manually attached
- create warm draft only for safe reply classes
- create urgent notification for high-value or risky inbound classes

Inbound processing is not blocked by campaign pause.

### Delivery/status event processing

For provider delivery/status events, the worker must:

- resolve the existing `outbound_message` by provider message id, stable metadata, or idempotency key
- update delivery/send status idempotently
- append business events only once
- create suppression state for complaint and hard bounce
- create urgent notification or work item for complaint, hard bounce, and serious delivery failure

Delivery/status events must not create new outbound messages.

If a provider event cannot be matched to an outbound message, create an operator-visible reconciliation work item rather than silently dropping it.

### Unsubscribe handling

Unsubscribe signals can arrive through:

- explicit provider unsubscribe event
- inbound reply classification
- manual operator action

All paths must use the same deterministic suppression service.

Suppression creation must be idempotent by normalized email/contact/organization scope and reason.

### State transition precedence

Some provider statuses are terminal or stronger than earlier statuses.

Recommended precedence from weaker to stronger:

- `sent`
- `delivery_delivered`
- `delivery_bounced`
- `complained`
- `suppressed_after_send`

A late weaker event must not downgrade a stronger state.

Example: a late delivered event must not override a complaint.

### Relationship to ambiguous send

Provider events may resolve `send_ambiguous`.

If a delivery/status webhook confirms provider acceptance for a `send_ambiguous` outbound message, the system may move it to `sent` or the stronger delivered/bounced/complained state and resolve the reconciliation work item.

If no provider confirmation arrives after the reconciliation window, the item remains operator-visible.

### Error handling

Parsing or processing failures leave the raw `webhook_events` row intact.

Retry is allowed for transient processing failures.

Poison events move to `dead_lettered` with an operator-visible issue if they affect send/delivery or inbound reply handling.

## 64. Inbound Reply Thread Matching Pipeline

Inbound reply handling is deterministic until the reply is safely attached to a thread.

ADK reply classification must not run against an unmatched or ambiguous inbound message.

### Processing sequence

For each persisted inbound email event, the worker performs:

1. parse inbound message
2. persist `inbound_messages`
3. dedupe by provider identity and normalized message identity
4. match to an existing thread
5. attach or triage
6. classify reply only after attachment
7. route classification outcome
8. optionally generate warm draft
9. refresh thread summary

### Match signals

Strong signals:

- `In-Reply-To` maps to a known outbound `Message-ID`
- `References` contains a known outbound `Message-ID`
- provider metadata maps to known `outbound_message`
- recipient alias and outbound header linkage map to known thread

Medium signals:

- sender email already exists as a thread participant
- sender domain matches organization domain
- normalized subject matches recent active thread
- reply is inside the active thread window

Weak signals:

- same organization but different subject
- generic sender such as `info@` or `hello@`
- missing headers
- multiple active or recently active candidate threads

### Match outcomes

`matched_strong`:

- attach inbound to thread automatically
- add new sender as participant if needed
- emit `thread_matched`
- enqueue reply classification

`matched_medium`:

- attach automatically only if there is exactly one candidate and no conflict
- store match method and confidence
- emit `thread_matched`
- enqueue reply classification

`ambiguous`:

- do not classify
- do not generate warm draft
- create `thread_match_ambiguous`
- create manual triage work item with candidate threads

`unmatched`:

- do not classify
- do not generate warm draft
- create unmatched inbound work item
- keep inbound message inspectable in the dashboard

### Participant expansion

If an inbound message is matched to a thread and the sender belongs to the same organization, the sender may be added as a `thread_participant`.

This supports flows such as:

- original outbound to `info@company.com`
- reply from `john@company.com`
- same company thread continues with John as participant

Participant expansion must not create a new cold thread.

If the sender belongs to a different organization, the system must not auto-add them as participant without manual review.

### Manual attach

Manual attach is an operator command.

`attach_inbound_to_thread` must:

- verify the inbound is not already attached to a different thread
- attach the inbound to the selected thread
- optionally add participant
- resolve the ambiguous/unmatched work item
- emit `thread_matched_manually`
- enqueue reply classification

Manual attach is the point where classification becomes allowed for previously ambiguous inbound.

### Reply classification gate

Reply classification requires:

- inbound message attached to exactly one thread
- thread not closed
- suppression/compliance state checked
- inbound not classified already under the same classification version
- no unresolved participant/organization conflict

Classification output is a proposal until deterministic routing applies it.

### Warm draft generation policy

Warm draft generation is allowed only for safe classes:

- `positive_interest`
- `question`
- `neutral`

Warm draft generation is blocked or routed to manual/work-item flows for:

- `unsubscribe`
- `negative`
- `wrong_person`
- `not_now`
- `auto_reply_or_noise`
- ambiguous or low-confidence classification

### Special class routing

`unsubscribe`:

- create suppression through deterministic suppression service
- update contact/thread state
- notify operator
- do not generate warm draft

`wrong_person`:

- extract referred contact if present
- create or update contact candidate
- move thread to `needs_reassignment`
- create reassignment work item
- do not auto-send or auto-start a new cold thread

`not_now`:

- persist deferred state and retry/cooldown date when available
- create resurfacing work item
- do not generate immediate acknowledgment by default

`auto_reply_or_noise`:

- mark as low-value/noise
- avoid warm draft generation
- optionally refresh thread summary if useful

### Concurrency

Inbound processing that mutates a thread should use `thread:{id}` concurrency key after a thread is known.

Before a thread is known, use the most specific available key:

- `organization:{id}` when organization is known
- inbound dedupe key when organization is unknown

This prevents two inbound replies from racing into conflicting thread state.

## 65. Inbox and Work Item Prioritization

Inbox is the operator's execution queue.

It should reduce cognitive load, not mirror every raw database record.

### Work item model

Recommended `work_items` fields:

- `id`
- `type`
- `status`
- `priority`
- `source_entity_type`
- `source_entity_id`
- `campaign_id` nullable
- `organization_id` nullable
- `thread_id` nullable
- `draft_id` nullable
- `inbound_message_id` nullable
- `outbound_message_id` nullable
- `title`
- `summary`
- `reason_code`
- `action_label`
- `available_at`
- `due_at` nullable
- `resolved_at` nullable
- `resolved_by_operator_id` nullable
- `dedupe_key`
- `created_at`
- `updated_at`

Allowed statuses:

- `open`
- `snoozed`
- `blocked`
- `resolved`
- `dismissed`
- `superseded`

### Priority bands

Use explicit priority bands instead of arbitrary numbers in UI language.

Recommended bands:

- `p0_urgent`
- `p1_high`
- `p2_normal`
- `p3_low`

`p0_urgent` should also be eligible for Telegram notification.

### P0 urgent

These items should appear at the top of Inbox and may notify Telegram:

- complaint received
- hard bounce received
- explicit unsubscribe
- serious send failure
- unresolved `send_ambiguous`
- inbound positive/urgent reply requiring fast operator action
- policy/compliance blocker that affects active sending

### P1 high

These items should be handled before normal cold-review work:

- ambiguous inbound reply
- unmatched inbound reply
- `wrong_person` reassignment
- warm draft ready
- warm reply needs research
- reply classification needs review
- unmatched provider delivery/status event

### P2 normal

These are normal daily operator work:

- cold draft ready
- cold draft needs single-draft claim review
- organization research needed for cold draft
- contact selection review needed
- campaign discovery review needed

### P3 low

These should not interrupt active reply handling:

- follow-up eligible
- deferred `not_now` resurfaced
- low-confidence research review not blocking active reply
- stale summary refresh review
- non-urgent quality/readiness review

### Deduplication

Work items need stable dedupe keys.

Examples:

- `ambiguous_inbound:{inbound_message_id}`
- `unmatched_inbound:{inbound_message_id}`
- `send_ambiguous:{outbound_message_id}`
- `draft_review:{draft_id}:{draft_version}`
- `research_needed:{organization_id}:{campaign_id}:{reason_code}`
- `policy_blocker:{policy_state_entry_id}`
- `follow_up:{thread_id}:{available_at_date}`

Creating the same item twice should update the existing open item, not create queue noise.

### Superseding

Some work items become obsolete when newer state appears.

Examples:

- a new draft version supersedes review items for an older draft version
- manual attach resolves ambiguous/unmatched inbound items
- provider confirmation resolves `send_ambiguous`
- suppression resolves future-send policy warnings for that reason
- campaign close supersedes cold expansion items

Superseded items should remain auditable but disappear from the active Inbox.

### Batchable vs non-batchable

Non-batchable:

- complaint
- unsubscribe
- hard bounce
- ambiguous send
- ambiguous/unmatched inbound
- warm reply review
- policy blocker on an active send

Batchable:

- cold draft review
- cold research needed
- contact selection review
- follow-up eligible
- low-priority quality/readiness review

The Inbox UI may group batchable items by campaign or organization.

### Sorting

Default sort:

1. priority band
2. `available_at`
3. warm before cold
4. due/age
5. campaign priority
6. created_at

Within the same thread, show the latest actionable item first and collapse older superseded or dependent items.

### Work item actions

Each item must expose the next valid operator action, not a generic status.

Examples:

- `Review Reply`
- `Attach Inbound`
- `Resolve Send Ambiguity`
- `Review Draft`
- `Research More`
- `Review Sources`
- `Reassign Contact`
- `Apply Suppression`
- `Dismiss`
- `Snooze`

State-changing actions must map to persisted commands.

Read-only navigation actions do not create commands.

### Relationship to Telegram

Telegram should not mirror the whole Inbox.

Telegram sends:

- P0 urgent notifications
- summary links for batches of draft-ready or research-needed items
- explicit operator-requested command confirmations when Telegram command surface is enabled

Inbox remains the primary operating surface.

## 66. Policy and Guardrails Model

Policy enforcement is deterministic and sits outside ADK.

Agents may propose actions, but policy services decide whether workflow can continue.

### Policy layers

MVP has three policy layers:

- permanent or semi-permanent suppression
- temporary operational policy state
- per-action guardrail evaluation

These must stay separate.

### Suppression

Suppression means future sending is blocked for a scope until explicitly removed.

Supported scopes:

- contact
- organization
- domain

Suppression reasons:

- `unsubscribe`
- `complaint`
- `hard_bounce`
- `manual_do_not_contact`
- `compliance`

Complaint, hard bounce, explicit unsubscribe, and manual do-not-contact are hard blocks.

Suppression creation is idempotent by scope and reason.

### Policy state

Policy state is operational and may expire or be resolved.

Supported state types:

- `cooldown`
- `retry_after`
- `manual_hold`
- `manual_override`
- `compliance_flag`

Policy state is not the same as suppression.

Examples:

- `not_now` creates retry/cooldown state, not permanent suppression
- `manual_hold` pauses work on a thread or organization
- `manual_override` can allow a warning-level action but must not bypass suppression or compliance hard blocks
- `compliance_flag` blocks sending until resolved

### Guardrail evaluator

Before sensitive actions, call a deterministic guardrail evaluator.

Inputs:

- action type
- campaign
- organization
- contact
- thread
- draft version
- outbound message if applicable
- suppression entries
- pending unprocessed suppression-class webhook events for the recipient
- policy state entries
- claim safety state
- idempotency state

Output:

- `decision`: `allow`, `warn_confirm`, or `block`
- `reasons`
- `required_confirmation` nullable
- `blocking_policy_state_ids`
- `blocking_suppression_ids`
- `advisory_messages`

### Actions requiring guardrail evaluation

Required:

- `approve_draft_for_send`
- `job.send_email`
- `request_ai_revise` when revising a blocked draft
- `request_research_more` when research is blocked by campaign/thread state
- `generate_cold_draft`
- `generate_warm_draft`
- `create_followup_draft`

The worker must re-check hard guardrails before external side effects.

### Hard blocks

Hard blocks prevent continuation:

- active suppression
- pending unprocessed suppression-class webhook event for the recipient
- compliance flag
- invalid or unreachable recipient
- duplicate send/idempotency conflict
- unresolved thread ambiguity
- unresolved send ambiguity for the same thread/contact
- one-active-thread violation
- stale draft version
- missing or stale claim safety for approval
- unsupported central claim in draft
- campaign closed for cold expansion

### Warning / confirmation

Warning-level issues require explicit operator confirmation or manual edit:

- weak claim support
- uncertain recipient timezone
- suboptimal recipient-local timing
- soft personalization risk
- old research snapshot
- low confidence contact selection
- non-critical cooldown nearing expiry

Warnings must be persisted with the command or decision that confirmed them.

### Advisory

Advisory messages do not block or require confirmation:

- better send-time suggestion
- quality/readiness hints
- minor formatting note
- low-priority follow-up suggestion

### Manual override

Manual override is explicit and scoped.

It may override warnings or specific temporary policy states when allowed by policy.

It must not override:

- unsubscribe
- complaint
- hard bounce
- compliance hard block
- duplicate send idempotency conflict
- unsupported central claim

Manual override must record:

- operator id
- scope
- reason
- expiry if applicable
- policy state overridden

### Policy blocker work items

When policy blocks workflow, create or update a work item.

Examples:

- `policy_blocker:{policy_state_entry_id}`
- `suppression_blocker:{suppression_entry_id}:{source_entity_id}`
- `duplicate_send_blocker:{thread_id}:{recipient_email}`
- `claim_safety_blocker:{draft_id}:{draft_version}`

The work item should expose the next valid action:

- review policy
- remove cooldown
- resolve compliance flag
- edit draft
- research more
- dismiss blocked cold expansion

### Resurfacing

Expired or due policy states create resurfacing work:

- cooldown expired
- retry-after date reached
- not-now follow-up eligible
- manual hold expired if expiry exists

Resurfacing should update or create one deduped work item, not spam the Inbox.

## 67. Prospect Discovery, Organization Dedupe, and Contact Selection

Prospect discovery is agentic, but accepting prospects into domain state is deterministic.

ADK may propose organizations and contacts; domain services decide what becomes a durable organization, contact, outreach, or work item.

### Discovery candidate lifecycle

Campaign discovery produces candidate organizations.

Recommended candidate states:

- `proposed`
- `accepted`
- `duplicate`
- `rejected_by_policy`
- `insufficient_fit`
- `needs_review`
- `queued_for_enrichment`
- `enriched`

Candidate records should store:

- campaign id
- proposed organization name
- domain
- website URL
- country/region if known
- source refs
- fit rationale
- confidence
- dedupe result
- rejection reason nullable

### Organization dedupe

Before creating or linking an organization, apply deterministic dedupe.

Strong dedupe signals:

- normalized root domain match
- exact known website URL match after canonicalization
- known provider/source id match if available

Medium dedupe signals:

- normalized legal/company name match
- same name plus same country/region
- same social/profile URL

Weak dedupe signals:

- similar name only
- same brand-like token with no domain
- ambiguous parent/subsidiary relationship

Strong matches should auto-link to the existing organization.

Medium matches may auto-link only if there is exactly one candidate and no conflicting domain or suppression state.

Weak or conflicting matches create `organization_dedupe_review_needed`.

### Policy gate before enrichment

Do not enqueue enrichment for candidates that are clearly blocked.

Block or reject:

- suppressed domain
- suppressed organization
- excluded country/segment from campaign scope
- obvious competitor or excluded category
- invalid or missing domain when domain is required by the campaign

If blocked by policy, create/update a policy or discovery review item rather than silently dropping important candidates.

### Organization enrichment outcomes

Organization research produces:

- versioned research snapshot
- verified facts/evidence
- risks
- contact candidates
- fit assessment

Allowed outcomes:

- `enriched`
- `insufficient_fit`
- `needs_research`
- `needs_review`
- `rejected_by_policy`
- `failed`

Only `enriched` organizations continue automatically to contact selection.

`needs_review` creates `organization_research_review_needed`.

`insufficient_fit` stops cold outreach for that organization in the campaign but preserves the record and rationale.

### Contact candidate promotion

`research_contact_candidates` are proposals, not final contacts.

Promotion to `contacts` requires deterministic validation:

- normalized email or stable contact identity
- organization match
- role/title fit
- reachability confidence
- suppression check
- no duplicate existing contact

If a candidate lacks email but has a useful profile, keep it as a candidate and create `contact_research_needed` if the organization is otherwise promising.

### Contact selection policy

Cold outreach starts with one primary contact per company.

The selector may also persist fallback contacts, but parallel cold outreach to multiple contacts in the same organization is blocked.

Selection inputs:

- campaign context
- organization research snapshot
- contact candidates
- existing contacts
- suppression/policy state
- prior thread/outreach history
- wrong-person referrals

Selection output:

- primary contact id nullable
- fallback contact ids
- confidence
- rationale
- risks
- outcome

Allowed outcomes:

- `primary_selected`
- `no_actionable_contact`
- `needs_contact_research`
- `needs_review`
- `blocked_by_policy`

### Selection hard blocks

Do not select:

- suppressed contact
- contact under do-not-contact
- contact with hard bounce
- contact from suppressed organization/domain
- contact that would violate one-active-thread per company
- contact with invalid/unverified email when verified email is required

If the best candidate is blocked, create a policy/contact-selection work item instead of selecting the next weak candidate blindly.

### Low-confidence handling

Low-confidence contact selection should not silently continue to drafting.

If contact fit is weak or evidence is thin:

- create `contact_selection_review_needed`
- keep candidate ranking visible
- do not enqueue cold draft generation until resolved

### No actionable contact

`no_actionable_contact` is a real outcome, not a technical failure.

It should:

- emit `no_actionable_contact_found`
- stop cold drafting for that organization/campaign
- optionally create `contact_research_needed` if the organization fit is high
- preserve the organization for reporting and future research

### Referred contacts

When a `wrong_person` reply provides a referred contact:

- create or update a contact candidate
- link it to the referring inbound/thread
- require normal suppression and contact selection checks
- require operator review before new outbound

Referred contact does not bypass zero-autosend.

### Draft generation gate

Cold draft generation requires:

- active campaign
- enriched organization
- selected primary contact
- passing policy/guardrail checks
- no active thread conflict
- usable research snapshot

If any condition fails, create the relevant work item rather than generating a draft with missing context.

## 68. Organization Detail, Stats, and Outcomes

Organization Detail is the company-level inspection surface.

It lets the operator understand what happened with a company across campaigns, contacts, drafts, sends, replies, and policy state.

It is not a full CRM list page in MVP.

### Source of truth

Organization Detail should be assembled from:

- `organizations`
- `campaigns`
- `outreach_records`
- `contacts`
- `thread_participants`
- `threads`
- `drafts`
- `outbound_messages`
- `inbound_messages`
- `research_snapshots`
- `research_facts`
- `suppression_entries`
- `policy_state_entries`
- `work_items`
- `event_log`

If denormalized counters are added later, they are cache/read-model data and must be recomputable.

### Header summary

The header should show:

- organization name
- domain / website
- country or region when known
- active campaign links
- current outreach status
- current thread status
- suppression/cooldown/compliance indicators
- latest research status
- last meaningful activity timestamp

### Lifecycle lane

Show the organization's current lifecycle in the campaign context:

- discovered
- deduped / linked
- enriched
- contact selected
- draft ready
- sent
- reply received
- warm reply in progress
- closed / stopped / no actionable contact

This lane is derived from current domain state plus event history.

### Campaign and outreach history

Show every campaign/outreach involving the organization:

- campaign name
- outreach id
- primary contact
- current status
- draft count
- send count
- reply count
- latest outcome
- next open work item if any

The operator should be able to jump from an outreach row to the relevant Thread View or draft review.

### Contact and participant panel

Show:

- primary contact
- fallback contacts
- research contact candidates
- thread participants
- referred contacts
- suppression/reachability state
- source and confidence
- last interaction if any

Contact candidates must be visually distinct from promoted contacts.

Suppressed contacts must be visible, not hidden, so the operator can understand why the system skipped them.

### Research panel

Show:

- latest research snapshot
- research status
- fit assessment
- verified facts
- evidence/source links
- risks
- missing information
- contact-fit overview
- previous research snapshots when useful

Facts used in drafts should be linkable from the draft claim UI back to this research panel.

### Draft/send/reply stats

Minimum MVP stats:

- discovered count contribution by campaign
- research pass count
- contact candidates found
- drafts generated
- drafts approved
- drafts rejected/skipped
- manual edits count
- sends requested
- sends confirmed
- delivery bounces
- complaints
- replies received
- positive replies
- negative replies
- not-now replies
- wrong-person replies
- unsubscribe replies
- warm drafts generated
- warm replies approved/sent

Stats should be scoped by organization and optionally filtered by campaign.

### Outcome labels

Organization-level outcome should be derived, not manually free-typed.

Recommended labels:

- `not_contacted`
- `research_in_progress`
- `insufficient_fit`
- `no_actionable_contact`
- `draft_ready`
- `sent_awaiting_reply`
- `positive_reply`
- `question_or_needs_response`
- `not_now`
- `wrong_person`
- `negative_reply`
- `unsubscribed`
- `bounced`
- `complained`
- `closed_manually`

The label should include a reason and source event when possible.

### Timeline

Organization timeline should be event-log backed.

Show business events, not every job retry.

Examples:

- organization discovered
- organization deduped/linked
- research snapshot created
- primary contact selected
- draft created
- draft approved
- outbound sent
- delivery updated
- inbound received
- reply classified
- warm draft created
- suppression created
- policy state changed
- work item opened/resolved

Job execution details remain drill-down/debug information, not default operator timeline noise.

### Open issues and next action

Organization Detail should surface the next meaningful operator action:

- review draft
- attach inbound
- resolve policy blocker
- research more
- select contact
- reassign contact
- inspect sources
- dismiss/close

If multiple work items exist, show the highest-priority active one first and provide a link to all related work items.

### Learning/audit value

Organization Detail is also the easiest place to audit why a future model should or should not learn from an outreach.

It should preserve:

- approved drafts
- rejected drafts and feedback
- operator edits
- reply outcomes
- claim safety results
- facts and sources used
- policy blocks

This supports future autosend readiness without enabling autosend in MVP.

## 69. Operator Feedback and Learning Capture

MVP should collect decision-quality data while keeping sending operator-controlled.

The purpose is to make future constrained autosend possible, not to enable autosend now.

### Feedback records

Recommended `operator_feedback` fields:

- `id`
- `feedback_type`
- `source_entity_type`
- `source_entity_id`
- `campaign_id` nullable
- `organization_id` nullable
- `thread_id` nullable
- `draft_id` nullable
- `draft_version` nullable
- `operator_id`
- `tags`
- `note` nullable
- `reason_code` nullable
- `created_at`

Allowed feedback types:

- `approve_as_is`
- `approve_after_edit`
- `reject`
- `skip`
- `request_ai_revise`
- `request_research_more`
- `manual_edit`
- `claim_removed`
- `override_warning`
- `source_reviewed`

### Draft version learning snapshot

Each draft version should remain explainable.

For learning, store or derive:

- generator stage and model policy
- prompt/schema/rule/retrieval refs
- retrieved positive examples
- retrieved negative examples
- research snapshot id
- facts used
- claim validation result
- operator action
- edit severity
- feedback tags
- final approved version pointer
- send/reply outcome if sent

### Positive learning corpus

Add to positive corpus only when the artifact is safe and useful.

Eligible:

- approved cold draft with no unresolved claim safety issue
- approved warm reply with no policy or factual blocker
- operator-edited final version that was approved
- thread summary from a useful resolved thread
- feedback summary describing successful pattern

Do not add:

- drafts approved only after overriding serious warnings
- drafts later associated with complaint or unsubscribe due to content
- drafts with unsupported central claims
- drafts from ambiguous or manually disputed context

### Negative learning corpus

Add to negative corpus when the artifact teaches what to avoid.

Eligible:

- rejected draft
- skipped draft with reason
- major-redo draft
- removed claim text
- feedback note describing bad tone, bad targeting, unsupported claim, wrong contact, bad CTA, or hallucinated fact
- draft linked to complaint, hard negative reply, or safety issue

Negative corpus must remain separate from positive corpus.

It is used for anti-pattern retrieval and validation guidance, not as a generation exemplar.

### Neutral/audit-only data

Some data should be retained but not used for retrieval by default:

- source-open events without later decision
- old superseded drafts with no feedback
- failed generation attempts with technical errors
- incomplete research snapshots
- ambiguous inbound context before manual attach

These remain useful for audit/debugging but should not pollute positive or negative examples.

### Signal weights for readiness

MVP uses rule-based weights, not model training.

Suggested strong positive signals:

- approved as-is
- approved after minor edit
- positive reply after send
- question/interest reply after send
- fact-supported personalization

Suggested weak positive signals:

- approved after moderate edit
- operator note says useful but changed
- warm reply accepted with minor changes

Suggested negative signals:

- rejected
- skipped with quality reason
- major rewrite
- unsupported claim removed
- wrong contact
- unsubscribe/complaint/hard negative associated with content

Suggested blockers:

- active suppression
- unsupported central claim
- unresolved compliance flag
- unresolved send ambiguity
- hard bounce/complaint history

### Feedback summarization

Raw feedback notes are stored as-is.

Separate feedback summaries may be created for RAG:

- concise successful pattern
- concise anti-pattern
- applicable campaign/pillar/contact type
- evidence/source refs if relevant

Summaries must keep the original feedback reference.

### Learning event triggers

Events that may trigger learning jobs:

- draft approved
- manual edit saved
- draft rejected/skipped
- outbound sent
- reply classified
- complaint/bounce/unsubscribe received
- thread closed
- feedback note added
- quality score updated

Learning jobs are background work and must not block operator review or sending.

### Future autosend boundary

Autosend readiness labels and learning signals are advisory in MVP.

They may be used later to propose constrained autosend rules, but any future autosend must require a separate explicit design decision and policy gate.

## 70. Local Runtime, Ops, and Config

MVP is local-first and Dockerized.

The goal is to make normal daily operation possible without shell-driven debugging for routine cases.

### Compose services

Docker Compose should define:

- `dashboard`
- `worker`
- `postgres`

Optional later services:

- `maildev` or equivalent for local email simulation if useful
- separate embedding/model proxy only if needed

Do not split the worker into many containers in MVP.

Use one worker runtime with logical worker pools.

### Service responsibilities

`dashboard`:

- serves Next.js App Router UI
- exposes route handlers for operator commands
- exposes Resend webhook ingress
- performs SSR reads through service/repository layer
- does not execute heavy jobs or external side effects

`worker`:

- polls Postgres jobs
- leases jobs and writes `job_runs`
- executes deterministic stage handlers
- invokes ADK for agentic stage work
- calls Resend and external research/source tools
- performs embedding/indexing jobs
- writes domain state through services

`postgres`:

- stores domain truth
- stores jobs/commands/events/work items
- stores pgvector RAG data
- stores agent run metadata/artifact references

### Volumes

Use named volumes for:

- Postgres data
- local memory/artifact files if large artifacts are kept outside DB
- optional local development cache

Files in volumes are referenced from Postgres records when needed.

Do not rely on ephemeral container filesystem for product truth.

### Environment and secrets

Configuration comes from local env files or secret injection.

Required categories:

- database connection
- Resend API/webhook secrets
- sender mailbox/domain config
- Gemini/Vertex credentials or API keys
- model profile env vars
- Telegram bot token/chat config if enabled
- source-tool API credentials for X/Reddit/etc when enabled
- feature flags for external tools

Secrets must not be stored in:

- prompts
- `agent_runs.input_snapshot_json`
- `agent_runs.output_json`
- `agent_run_artifacts`
- event payloads
- committed config files

### Migrations

Migrations are explicit and run before app/worker use.

Local startup should support:

- create database if missing
- apply Drizzle migrations
- install/enable `pgvector`
- create HNSW indexes after vector tables exist

The worker should refuse to start job execution if the schema version is incompatible.

### Health checks

Minimum health checks:

- dashboard HTTP health
- worker process health
- Postgres connectivity
- migration/schema version compatibility
- worker can poll jobs
- Resend config present when send/webhook features are enabled
- model provider config present when agent stages are enabled

Health checks should not call expensive external APIs by default.

### Worker loops

The worker runs logical poll loops for:

- `urgent`
- `drafting`
- `background`

Each loop should have:

- concurrency cap
- poll interval
- max lease duration
- stale lease recovery
- graceful shutdown behavior

`urgent` must reserve capacity for replies, send operations, policy/compliance, and urgent notifications.

### Graceful shutdown

On shutdown, the worker should:

- stop leasing new jobs
- finish or safely release in-flight jobs when possible
- let leases expire for interrupted jobs
- persist attempt failure only when the job actually failed, not merely because the process stopped

### Observability counters

Dashboard header/ops surface should show:

- open P0/P1 work items
- failed/exhausted jobs
- stuck or stale leased jobs
- webhook processing failures
- send ambiguous count
- pending draft reviews
- pending warm replies
- pending research-needed items
- background indexing backlog
- last successful worker heartbeat

### Logs and artifacts

Logs are useful but not product truth.

Important explainability belongs in:

- `event_log`
- `job_runs`
- `agent_runs`
- `agent_run_events`
- `agent_run_artifacts`
- `webhook_events`
- domain records

### Local runbook

The repo should include a local runbook covering:

- required env vars
- compose startup
- migrations
- seed/test data if any
- webhook local testing strategy
- how to inspect failed jobs
- how to replay/requeue safe jobs
- how to stop containers safely
- backup/restore of local Postgres volume

### Backups

Even local MVP should treat Postgres as valuable product data.

At minimum, document manual backup/restore for:

- Postgres data
- local artifact volume
- env/secrets stored outside repo

## 71. Security, Privacy, and Data Retention

MVP is local-only and single-operator, but it still handles sensitive outreach data.

The system should minimize unnecessary exposure of secrets, personal data, raw emails, and external-source artifacts.

### Access model

MVP assumptions:

- local dashboard only
- single trusted operator
- no public multi-user auth system in MVP
- Telegram links are convenience links into the local desktop workflow

Even with this assumption, route handlers should not expose unrestricted data dumps.

Future multi-user access requires a separate auth/authorization design.

### Sensitive data categories

Treat the following as sensitive:

- email addresses
- names and roles
- raw inbound/outbound email bodies
- email headers
- provider payloads
- contact candidates
- suppression reasons
- complaint/bounce/unsubscribe events
- operator notes
- research source artifacts
- model/tool outputs that include personal data
- API keys, tokens, webhook secrets, service-account credentials

### Storage principles

Store what is needed for audit, safety, and future learning.

Do not duplicate raw sensitive content into many tables.

Preferred pattern:

- raw payload stored once in provider/source table or artifact storage
- normalized fields stored in domain tables
- references used from events, snapshots, and artifacts
- summaries used for UI where raw content is unnecessary

### Raw email retention

Raw inbound and outbound content is useful for audit and reply reconstruction.

MVP should retain it locally, but keep it out of:

- RAG by default
- prompts unless needed for the specific stage
- event summaries
- ops counters
- logs

When prompt context needs email content, include only the minimal relevant thread excerpt.

### Agent prompt boundaries

Agent input should be materialized and minimized.

Do not pass:

- secrets
- raw env values
- unrestricted database rows
- full mailbox history
- unrelated contacts
- unrelated campaigns
- large raw webhook payloads
- unnecessary PII

Pass:

- bounded campaign context
- relevant organization context
- relevant thread excerpt
- verified facts
- selected contact data required for the task
- retrieved memory refs/summaries
- policy constraints

### RAG eligibility and privacy

RAG indexes curated artifacts only.

Do not embed by default:

- raw inbound email bodies
- raw outbound payload snapshots
- raw provider webhook payloads
- raw search/fetch dumps
- full contact lists
- secrets or credentials
- neutral/audit-only artifacts

Embeddable artifacts should be curated, labeled, and scoped:

- approved draft text
- approved warm reply text
- rejected draft text when useful as anti-pattern
- feedback summaries
- thread summaries
- safe research summaries

### Redaction

Before storing artifacts intended for logs, RAG, or broad UI display, redact or avoid:

- API keys and tokens
- webhook signatures
- cookies
- authorization headers
- private email headers not needed for thread matching
- unrelated personal emails
- large quoted email history unrelated to the current reply

Domain records may store actual recipient emails because sending and suppression require them.

### Logs

Logs should be operational, not a data warehouse.

Avoid logging:

- full prompts
- full raw emails
- full provider payloads
- secrets
- credentials
- long tool outputs

Use ids, event names, job ids, command ids, and short error messages.

Detailed explainability belongs in controlled tables/artifacts.

### External tool data

External search/source tools must have:

- allowlists per stage
- rate limits
- response size caps
- source attribution
- artifact persistence
- no secret echoing

Tool outputs are not trusted facts until validated.

### Webhook security

Webhook ingress must:

- verify provider authenticity
- reject invalid signatures
- persist raw payload only after authenticity checks where possible
- dedupe provider retries
- avoid returning sensitive error details

Invalid webhook attempts may be counted, but raw invalid payload retention should be minimized.

### Data deletion and suppression

Suppression is not deletion.

If a contact or organization is suppressed, keep enough data to enforce do-not-contact and explain why.

Future deletion/anonymization workflows are out of MVP, but the schema should avoid unnecessary duplication so deletion is possible later.

### Backups

Backups contain sensitive data.

Backup documentation should state:

- where backup files are written
- that backups must not be committed
- how to delete old backups
- that env/secrets are backed up separately from repo files

## 72. Agent Run Input Snapshot

Every `agent_run` must store `input_snapshot_json`.

The snapshot records what the agent saw at execution time. It is not a full database dump.

### Top-level structure

Recommended shape:

```json
{
  "schema_version": "1",
  "stage_name": "ColdDraftGenerationService",
  "job_id": "...",
  "job_run_id": "...",
  "correlation_id": "...",
  "created_at": "...",
  "model_policy": {},
  "entity_refs": {},
  "input_context": {},
  "tool_allowlist": [],
  "output_schema_name": "...",
  "validation_rules": {}
}
```

### `model_policy`

Store:

- provider
- model name
- temperature
- output token budget
- structured-output mode if relevant
- timeout/retry policy reference if relevant

### `entity_refs`

Store references such as:

- `campaign_id`
- `organization_id`
- `contact_id`
- `outreach_id`
- `thread_id`
- `inbound_message_id`
- `draft_id`

Refs are required, but the snapshot must also contain the relevant materialized context because domain records may change later.

### `input_context`

This is stage-specific materialized context.

Examples:

- campaign discovery: objective, offer summary, target segments, exclusions, operator notes
- organization research: organization domain/name, campaign framing, previous research summary, known contacts
- contact selection: contact candidates, policy state, wrong-person history
- cold drafting: campaign context, organization snapshot, primary contact, verified facts, risks, retrieved memory refs, forbidden claims, CTA
- reply classification: inbound parsed text, thread summary, participants, organization summary, policy state
- warm drafting: latest inbound, thread summary, reply class, research snapshot, retrieved memory refs, forbidden claims

### `tool_allowlist`

Store the exact tool names available to that run.

This supports debugging and security review.

### `output_schema_name`

Use versioned schema names such as:

- `organization_research_output_v1`
- `cold_draft_output_v1`
- `reply_classification_output_v1`

### `validation_rules`

Store relevant rule identifiers and parameters:

- forbidden claims
- allowed reply classes
- required fields
- required fact-reference policy
- draft length constraints if used

### Exclusions

Do not store:

- API keys
- raw env
- unrestricted DB rows
- huge raw HTML pages
- unbounded RAG dumps
- full raw MIME if already stored elsewhere

Large artifacts should live in `agent_run_artifacts` or source tables and be referenced from the snapshot.

## 73. Agent Run Output and Validation

`agent_runs.output_json` stores the structured proposal returned by the agent runtime plus validation metadata.

It does not directly mutate domain state.

### Recommended shape

```json
{
  "schema_version": "1",
  "stage_name": "ReplyClassificationService",
  "runtime": "adk",
  "status": "completed",
  "raw_output": {},
  "normalized_output": {},
  "validation": {
    "status": "passed",
    "errors": [],
    "warnings": []
  },
  "commit_plan": {
    "operation": "classify_reply",
    "target_entity_refs": {}
  }
}
```

### `raw_output`

The direct structured output from the agent runtime.

Use for:

- debugging
- model regression analysis
- future learning

### `normalized_output`

The schema-normalized output after:

- enum normalization
- date parsing
- confidence clamping
- unsupported field removal
- source/fact reference normalization

### `validation`

Validation should include:

- status: `passed`, `failed`, or `passed_with_warnings`
- errors
- warnings
- validator version where useful

Validation categories:

- schema validation
- enum validation
- required fields
- max length / content policy
- forbidden claims
- fact references
- allowed tool-output references
- safety flags

### `commit_plan`

`commit_plan` describes what deterministic domain service will do if validation passes.

Examples:

- `create_draft_version`
- `update_reply_classification`
- `write_research_snapshot`
- `create_contact_candidates`
- `create_thread_summary`

It is not itself a mutation.

### Validation pipeline

1. ADK returns output
2. runtime adapter extracts structured output
3. adapter normalizes output
4. schema validator runs
5. stage-specific validator runs
6. safety validator runs
7. commit plan is built
8. deterministic domain service commits valid output

### Invalid output handling

Formatting/schema issues may use one bounded repair attempt.

Safety or factual validation failures should not be silently repaired.

Examples:

- draft used unverified claim
- classification produced an unknown reply class
- contact selection picked a suppressed contact

These should become workflow-visible failures or `needs_research` / `needs_review` outcomes.

## 74. Bounded Repair Loops

ADK `LoopAgent` may be used only for bounded repair, not open-ended autonomous improvement.

### Allowed repair use cases

#### Structured output repair

Allowed for:

- almost-valid JSON
- enum normalization
- date format repair
- confidence range repair
- missing field repair when derivable from existing output

#### Draft validation repair

Allowed for:

- draft too long
- missing subject
- formatting issues
- CTA mismatch
- minor tone/structure issue

### Disallowed automatic repair

Factual and safety failures should not be silently repaired.

Examples:

- unverified claim
- fact without verified source reference
- forbidden claim violation
- suppressed contact
- unsafe classification despite unsubscribe signal

These should become structured workflow outcomes such as `needs_research`, `needs_review`, or `manual_triage`.

### Stage-specific rules

- `ColdDraftGenerationService`: one repair pass for format/tone/length; missing facts become `needs_research`
- `WarmDraftGenerationService`: one repair pass for tone/length/structure; missing factual answer becomes `needs_research`
- `OrganizationResearchService`: schema repair only; research expansion must be bounded by job policy
- `ReplyClassificationService`: enum/schema repair only; ambiguity becomes manual triage

### Loop limits

MVP defaults:

- max repair attempts = 1
- max 2 only for pure formatting if explicitly allowed
- every repair attempt is stored as artifact
- final failure remains visible

### Repair artifacts

Store:

- validation errors that triggered repair
- repair prompt/context
- repaired raw output
- validation result

## 75. Agent Run Outcomes

Agentic stages need structured non-success outcomes.

Not every non-completed stage result is a technical failure.

### Recommended `agent_run_outcome`

- `completed`
- `needs_research`
- `needs_review`
- `manual_triage`
- `blocked_by_policy`
- `insufficient_context`
- `invalid_output`
- `failed`

### Meaning

#### `completed`

Validated output can be committed by a deterministic domain service.

#### `needs_research`

The stage correctly determined that verified facts, sources, or context are insufficient.

Examples:

- draft would require an unverified claim
- reply asks a factual question not covered by research snapshot
- contact rationale is too weak

#### `needs_review`

The stage produced a result, but confidence or risk demands extra human attention.

Examples:

- borderline classification
- risky tone
- low fact confidence but potentially usable content

#### `manual_triage`

Automatic routing/classification/matching is unsafe.

Examples:

- ambiguous reply match
- unclear reply intent
- possible unsubscribe but not explicit

#### `blocked_by_policy`

Policy prevents continuation.

Examples:

- suppressed contact
- active cooldown
- one-active-thread violation

#### `insufficient_context`

Required domain context was missing from the input snapshot.

#### `invalid_output`

Agent output could not be validated or repaired.

#### `failed`

Technical failure such as provider outage, tool crash, ADK runtime error, or unexpected exception.

### Storage

Store in `agent_runs`:

- `outcome`
- `outcome_reason`
- `outcome_payload_json`

Mirror the same structured outcome in `output_json`.

### Job status boundary

`agent_run_outcome` is not the same as job status.

Example:

- agent outcome = `needs_research`
- job status = `completed`

The job succeeded technically. The workflow result requires a next action.

Technical job failure is reserved for invalid execution failures, not normal domain outcomes.

## 76. Agent Outcome Routing

Every `agent_run_outcome` must map to an explicit next workflow state.

Outcomes must not be recorded and then left hanging.

### Outcome mapping

#### `completed`

Apply validated output through deterministic domain service.

Then:

- create/update relevant work item
- enqueue next job if workflow continues
- write event_log fact

#### `needs_research`

Create a research-oriented next action.

Examples:

- `research_needed` work item
- `request_research_more` command/job
- `research_needed_for_reply` work item

Do not blindly retry the same generation job.

#### `needs_review`

Create a `review_needed` work item with outcome reason and usable agent output if available.

#### `manual_triage`

Create a `manual_triage` work item with:

- target scope
- reason
- candidate matches or options where relevant

#### `blocked_by_policy`

Create/update policy blocker state and operator-visible work item if needed.

Do not retry and do not create drafts/sends.

#### `insufficient_context`

Route based on cause:

- upstream fix job if recoverable
- relevant work item such as `contact_selection_needed`
- ops-visible failure if expected entity is missing unexpectedly

#### `invalid_output`

Use repair/retry/exhausted policy depending on validation class.

#### `failed`

Use technical job retry/exhaustion policy.

### Deterministic router

Routing should be centralized in a deterministic `AgentOutcomeRouter`.

The router:

- receives validated `agent_run_outcome`
- creates work items, commands, jobs, and events
- applies consistent routing rules across stages

Stage services should not each invent their own outcome routing behavior.

## 77. AgentOutcomeRouter Service

`AgentOutcomeRouter` is mandatory in MVP.

It is a deterministic domain/service-layer component, not an ADK agent.

### Inputs

- `agent_run`
- `agent_run_outcome`
- `normalized_output`
- `validation`
- `stage_name`
- `entity_refs`
- `correlation_id`

### Responsibilities

The router decides:

- which domain writes to apply
- which work items to create
- which commands/jobs to enqueue
- which event_log facts to append

### Why it exists

Stage services should not each implement their own routing logic.

Centralized routing avoids:

- duplicated outcome handling
- inconsistent `needs_research` behavior
- inconsistent work item creation
- scattered blocker/retry semantics

### Stage-specific routing

The router must consider both:

- `stage_name`
- `agent_run_outcome`

Example:

- `needs_research` from `ColdDraftGenerationService` creates an organization/outreach research item
- `needs_research` from `WarmDraftGenerationService` creates a thread/reply research item with higher urgency

### Transaction rule

Routing should be transactional where possible.

The router should commit related changes together:

- domain state update
- work item
- event_log entry
- next job or command

### Boundary

The router writes only business-relevant event_log facts.

ADK internal events remain in `agent_run_events`.

## 78. AgentOutcomeRouter MVP Routing Matrix

This is a code-level deterministic routing policy for MVP.

It should not be configurable through UI in MVP.

### `CampaignDiscoveryService`

`completed`:

- create/update discovered organization candidates
- link candidates to campaign
- enqueue `job.enrich_organization` within campaign fan-out limits
- emit `organization_discovered`

`needs_review`:

- create `campaign_discovery_review_needed`

`insufficient_context`:

- create `campaign_scope_incomplete`
- do not retry discovery until campaign fields are fixed

### `OrganizationResearchService`

`completed`:

- write versioned research snapshot
- create/update contact candidates
- emit `organization_enriched`
- enqueue `job.select_primary_contact`

`needs_research`:

- create `research_insufficient`
- optionally enqueue one bounded extra research job if policy allows

`needs_review`:

- create `research_review_needed`

`blocked_by_policy`:

- update policy blocker state
- do not enqueue contact selection

### `ContactSelectionService`

`completed`:

- write primary contact selection
- write fallback contacts
- emit `primary_contact_selected`
- enqueue `job.generate_cold_draft`

`needs_review`:

- create `contact_selection_review_needed`

`blocked_by_policy`:

- create/update policy blocker
- optionally emit `no_actionable_contact_found`
- do not create draft

`insufficient_context`:

- create `contact_research_needed`
- optionally enqueue research job

### `ColdDraftGenerationService`

`completed`:

- create draft version
- create `cold_draft_ready`
- emit `cold_draft_created`
- enqueue background score/indexing jobs if needed

`needs_research`:

- create `research_needed_for_cold_draft`
- optionally enqueue `job.refresh_research_snapshot`
- do not create ready draft

`needs_review`:

- create `cold_draft_review_needed`
- attach usable draft proposal if available

`blocked_by_policy`:

- create policy blocker work item
- do not create draft/send path

### `ReplyClassificationService`

`completed`:

- write reply classification
- emit `reply_classified`
- enqueue `job.generate_warm_draft` only for safe reply classes
- create reassignment work item for `wrong_person`
- create cooldown/pause outcome for `not_now`
- create suppression through deterministic policy service for `unsubscribe`

`manual_triage`:

- create `reply_manual_triage`
- do not generate warm draft

`needs_review`:

- create `reply_classification_review_needed`
- do not generate warm draft until resolved

`blocked_by_policy`:

- update blocker/policy work item
- do not generate warm draft

### `WarmDraftGenerationService`

`completed`:

- create warm draft version
- create `warm_draft_ready`
- emit `warm_draft_created`

`needs_research`:

- create `research_needed_for_warm_reply`
- prioritize above cold research because inbound is waiting
- do not create ready draft

`needs_review`:

- create `warm_reply_review_needed`
- attach usable proposal if available

`manual_triage`:

- create `warm_reply_manual_triage`
- do not create draft

### `ThreadSummaryService`

`completed`:

- write thread summary
- emit `thread_summary_refreshed`
- optionally enqueue RAG indexing

`invalid_output`:

- retry once
- if exhausted, keep old summary

### Global routing rules

- `failed` uses technical retry/exhaustion policy
- `invalid_output` uses repair/retry/exhaustion policy
- `blocked_by_policy` never retries and never starts next agentic work
- `manual_triage` creates operator work item
- `needs_research` creates research work item or bounded research job

## 79. ADK Sessions and State

ADK session/state is runtime-local and stage-local.

It is not product truth.

### Session lifetime

One `agent_run` should map to one bounded ADK session or execution context.

`agent_runs.runtime_session_id` stores the ADK session id.

The session lifetime is tied to one stage execution, not to a long-running product thread or campaign.

### Allowed ADK state

ADK state may contain temporary stage-local data:

- intermediate research findings
- temporary candidate lists
- tool call summaries
- validation errors during repair
- draft critique within one generation loop
- parallel sub-agent outputs before synthesis

### Disallowed ADK-only state

The following must not live only in ADK state:

- final research snapshot
- final draft
- final classification
- policy decision
- suppression
- thread state
- approved feedback
- long-term memory

These belong in Postgres-backed domain tables.

### ADK MemoryService

Do not use ADK MemoryService as long-term memory in MVP.

Long-term memory remains:

- Postgres domain data
- `rag_documents`
- `pgvector`
- positive/negative corpora
- operator feedback memory

ADK MemoryService may be reconsidered later only as an adapter/cache over traceable domain artifacts.

### ADK event stream

ADK events are useful for runtime observability.

They should be stored in `agent_run_events`, not `event_log`.

### Replay/debugging

Replay/debugging should rely on persisted records:

- `input_snapshot_json`
- `agent_run_artifacts`
- `agent_run_events`
- model policy
- `output_json`

The system must not depend on ADK sessions remaining alive forever.
- batch-blast based
- CRM-heavy
- analytics-heavy
- dependent on opaque AI judgment

The purpose of MVP is to run real outreach safely, collect decision-quality data, and create the foundation for future constrained autosend.
