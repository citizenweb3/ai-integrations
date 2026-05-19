# BizDev Outreach MVP Tickets

## Epic 1: Architecture and Schema

### Ticket 1.1
Define Drizzle schema for:
- campaigns
- organizations
- contacts
- outreach_records
- threads
- thread_participants
- drafts
- outbound_messages
- inbound_messages
- suppression_entries
- policy_state_entries
- work_items
- webhook_events
- event_log
- idempotency_registry
- commands
- jobs
- job_runs
- agent_runs
- agent_run_events
- agent_run_artifacts
- research_snapshots
- research_facts
- research_evidence
- research_fact_evidence
- research_contact_candidates
- draft_claims
- draft_claim_fact_refs
- operator_feedback
- rag_documents / embedding tables

### Ticket 1.1a
Define local Docker Compose runtime:
- `dashboard`
- `worker`
- `postgres`
- shared Docker network
- named Postgres volume
- optional local artifact volume

### Ticket 1.1b
Define env/secrets contract:
- database connection
- Resend API/webhook secrets
- sender mailbox/domain config
- Gemini/Vertex credentials or API keys
- model profile env vars
- Telegram bot config if enabled
- external source-tool credentials and feature flags
- no secrets in prompts, agent snapshots, artifacts, event payloads, or committed config

### Ticket 1.1c
Define migration/startup contract:
- Drizzle migrations
- pgvector extension setup
- HNSW index creation after vector tables
- schema version compatibility check
- worker refuses incompatible schema

### Ticket 1.1d
Define service health checks:
- dashboard HTTP health
- worker process health
- Postgres connectivity
- schema compatibility
- job polling capability
- required config presence
- no expensive external API calls by default

### Ticket 1.1e
Define security/privacy/data-retention contract:
- local-only single-operator assumption
- sensitive data categories
- raw email retention boundaries
- raw webhook payload retention boundaries
- no raw sensitive duplication across events/snapshots/logs/artifacts
- future multi-user auth deferred

### Ticket 1.1f
Define prompt/RAG privacy boundaries:
- minimized materialized prompt context
- no secrets or raw env
- no unrestricted DB rows
- no full mailbox history
- curated RAG artifacts only
- exclude raw emails, provider payloads, raw fetch dumps, full contact lists, and neutral/audit-only artifacts by default

### Ticket 1.1g
Define logging/redaction rules:
- no full prompts in logs
- no full raw emails in logs
- no full provider payloads in logs
- no secrets/credentials
- redact auth headers, cookies, webhook signatures, and API keys
- use ids and short errors for operational logs

### Ticket 1.2
Define status enums and state-transition rules for:
- research
- campaign
- contact
- draft
- delivery
- thread
- webhook_event
- outcome
- policy_state

### Ticket 1.3
Define command/service boundaries:
- start/pause/resume/close campaign
- create organization/contact
- create outreach
- create draft
- revise draft
- approve/send draft
- ingest inbound
- attach inbound manually
- suppress/unsuppress
- apply/remove cooldown or override

### Ticket 1.4
Define event-driven stage handler map:
- which commands/events trigger which handlers
- which side effects each handler is allowed to produce
- which flows are independent vs dependency-bound

### Ticket 1.5
Define `Campaign` model:
- required fields
- lifecycle states
- relationship to Outreach
- operator-facing commands
- readiness fields
- expansion caps

### Ticket 1.6
Define campaign lifecycle semantics:
- drafting_scope
- active
- paused
- closed
- what `pause` blocks
- what `pause` must not block
- what `resume` restarts
- what `close` supersedes

### Ticket 1.7
Define campaign expansion model:
- what `start_campaign` does synchronously
- which initial internal commands/jobs it creates
- how expansion proceeds through discovery/enrichment/contact-selection/drafting
- campaign-level concurrency and fan-out limits
- bounded expansion tick behavior
- backlog/capacity triggers for further expansion

### Ticket 1.7a
Define campaign readiness validation:
- objective
- offer summary
- desired CTA
- target segment or exclusion guidance
- forbidden claims
- sender identity
- policy profile
- discovery source strategy or seed hint
- incomplete scope creates `campaign_scope_incomplete`

### Ticket 1.7b
Define campaign expansion caps:
- max organizations to discover
- max new organizations per run
- max concurrent enrichments
- max concurrent drafts
- max open draft reviews
- advisory max daily send requests
- cooldown between discovery runs

### Ticket 1.7c
Define campaign status command/job gating:
- allowed/blocked commands in `drafting_scope`
- allowed/blocked commands in `active`
- allowed/blocked commands in `paused`
- allowed/blocked commands in `closed`
- worker-side gating before cold expansion jobs start

### Ticket 1.7d
Define discovery candidate lifecycle:
- proposed
- accepted
- duplicate
- rejected_by_policy
- insufficient_fit
- needs_review
- queued_for_enrichment
- enriched

### Ticket 1.7e
Define organization dedupe rules:
- strong domain / canonical website / provider id match
- medium company name + country/profile match
- weak similar-name or parent/subsidiary ambiguity
- review item for weak or conflicting matches

### Ticket 1.7f
Define organization enrichment outcomes:
- enriched
- insufficient_fit
- needs_research
- needs_review
- rejected_by_policy
- failed
- only enriched continues automatically to contact selection

### Ticket 1.7g
Define contact candidate promotion:
- normalize email/contact identity
- verify organization match
- role/title fit
- reachability confidence
- suppression check
- duplicate existing contact check

### Ticket 1.7h
Define contact selection outcomes:
- primary_selected
- no_actionable_contact
- needs_contact_research
- needs_review
- blocked_by_policy

### Ticket 1.7i
Define cold draft generation gate:
- active campaign
- enriched organization
- selected primary contact
- passing policy checks
- no active-thread conflict
- usable research snapshot

### Ticket 1.8
Define orchestration vocabulary and persistence model:
- operator commands
- internal system commands
- job types
- business-readable event names
- naming conventions and ownership rules for each category
- full canonical command catalog
- full canonical job catalog
- full canonical business-event catalog
- explicit rule that webhook ingress persists `webhook_events` and jobs, not provider-fact commands

### Ticket 1.9
Define command-handler boundary rules:
- which commands may mutate state immediately
- which commands are enqueue-only
- which events are emitted synchronously vs from worker execution
- which side effects are forbidden in command handlers

### Ticket 1.10
Define immediate-transition vs enqueue-only command map:
- campaign lifecycle commands
- draft review decisions
- thread/policy decisions
- research/generation commands
- inbound processing commands
- memory/recompute commands

### Ticket 1.11
Define Telegram command-surface boundary:
- how Telegram-originated actions map into persisted commands
- which actions are allowed in MVP
- confirmation rules
- what remains dashboard-only

### Ticket 1.12
Define shared `commands` table model:
- one table for operator and internal system intent commands
- statuses and lifecycle
- `source`, `correlation_id`, `parent_command_id`, `causation_event_id`
- idempotency-key rules
- rule for which intents deserve persisted command records
- webhook ingress persists `webhook_events` directly; downstream commands may be created only after worker interpretation

### Ticket 1.12a
Implement dashboard route-handler command API:
- no React-bound Server Actions for mutations by default
- one route-handler layer for operator commands
- shared command service used by dashboard and Telegram command surface
- idempotency-key handling
- command validation and lightweight guardrails
- no heavy work or external side effects in route handlers

### Ticket 1.13
Define `jobs` table and worker leasing model:
- statuses
- lease-token and lease-timeout rules
- retry and backoff rules
- `concurrency_key`
- eligibility ordering by `available_at`, `priority`, `created_at`
- exhausted/failed visibility rules

### Ticket 1.14
Define `job_runs` model:
- per-attempt execution history
- statuses
- worker ownership fields
- error/retry fields
- relationship to `jobs`
- distinction from `event_log`

### Ticket 1.15
Define `event_log` inclusion rules:
- which facts belong in `event_log`
- which telemetry stays only in `job_runs`
- when failures become event-log-worthy
- which events are suitable for timeline and learning

### Ticket 1.16
Define `event_log` schema:
- required fields
- lineage fields
- causality and correlation fields
- actor fields
- summary field
- index strategy

### Ticket 1.17
Define correlation model:
- one `correlation_id` for MVP
- no `trace_id` / `span_id` split
- how it relates to `parent_command_id`, `causation_event_id`, `job_id`, and `job_run_id`

### Ticket 1.18
Define `correlation_id` lifecycle rules:
- where root correlations are created
- how downstream commands/jobs/events inherit them
- when a new operator action creates a new correlation root
- why retries do not create new correlations

### Ticket 1.19
Define `jobs-as-outbox` rules:
- which side effects must run only from worker jobs
- transactional rule for state change plus job creation
- why no separate outbox table is needed in MVP
- idempotency requirements for external side effects

### Ticket 1.20
Define job classes:
- Class A outward communication jobs
- Class B external compute/provider jobs
- Class C internal compute/state jobs
- severity and visibility rules for each class

### Ticket 1.21
Define retry policy model:
- class defaults
- per-job-type overrides
- retryable vs non-retryable error classes
- ambiguity reconciliation rules
- exhausted-state severity rules

### Ticket 1.22
Define `concurrency_key` model:
- key domains for campaign, organization, thread, and outreach
- one-primary-key rule per job
- which jobs require conflict serialization
- relationship between concurrency keys and DB constraints

### Ticket 1.23
Define worker-pool model:
- one worker runtime with multiple logical pools
- `worker_pool` field on jobs
- per-pool polling behavior
- per-pool concurrency limits
- anti-starvation rules for urgent flows

### Ticket 1.24
Define MVP pool assignment:
- which job types belong to `urgent`
- which job types belong to `drafting`
- which job types belong to `background`
- context-sensitive assignment rules for LLM/provider calls

### Ticket 1.25
Define external agent-framework boundary:
- what remains in core worker orchestration
- why no external framework owns commands/jobs/events in MVP
- ADK selected for bounded stage-local agent internals
- LangGraph or plain typed services only as fallback if ADK proves unsuitable

### Ticket 1.26
Define MVP stage-service inventory:
- which services are strongly agentic
- which services are lightly agentic
- which services remain deterministic
- boundaries between service classes

### Ticket 1.27
Define ADK worker-agent runtime:
- Python ADK as the default worker-agent runtime
- mapping between Postgres jobs and ADK stage execution
- ADK session/state boundary
- ADK event capture as artifacts, not product truth

### Ticket 1.28
Document orchestration split:
- system orchestrator = custom Postgres-backed worker orchestration
- stage-level agent orchestrator = ADK
- guard against framework takeover of the top-level runtime

### Ticket 1.29
Define ADK-first worker-agent boundary:
- which stages are expected to use ADK
- what ADK may own locally
- what must remain in Postgres-backed domain/runtime layers
- fallback conditions for replacing ADK inside a bounded stage only

### Ticket 1.30
Define ADK integration exclusions:
- Vertex AI Agent Engine out of MVP
- A2A deferred until cross-service agents exist
- Gemini Live API out of scope for email outreach MVP

### Ticket 1.31
Define ADK stage mapping:
- CampaignDiscoveryService ADK shape
- OrganizationResearchService ADK shape
- ContactSelectionService ADK shape
- ColdDraftGenerationService ADK shape
- ReplyClassificationService ADK shape
- WarmDraftGenerationService ADK shape
- ThreadSummaryService ADK shape
- services that remain outside ADK
- LoopAgent guardrails

### Ticket 1.32
Define framework-neutral agent-run persistence:
- `agent_runs`
- `agent_run_events`
- `agent_run_artifacts`
- runtime metadata fields
- job_run linkage
- validation and domain-commit rules

### Ticket 1.33
Define ADK tool boundary:
- read-only domain tools
- research tools
- RAG tools
- validation tools
- per-stage tool allowlists
- no direct write/send tools in MVP
- tool-result artifact persistence

### Ticket 1.34
Define ADK toolsets by stage:
- CampaignDiscoveryService
- OrganizationResearchService
- ContactSelectionService
- ColdDraftGenerationService
- ReplyClassificationService
- WarmDraftGenerationService
- ThreadSummaryService
- deterministic handling for MemoryIndexingService

### Ticket 1.34a
Define external source tooling model:
- Gemini/ADK Google Search tooling for broad web search
- custom typed tools or MCP tools for Twitter/X, Reddit, GitHub, Discord, and other providers
- auth/rate-limit/timeout/response-cap rules
- source attribution and artifact persistence
- stage-specific source-tool allowlists

### Ticket 1.34b
Define ADK model/provider policy:
- deterministic `ModelPolicyResolver`
- Gemini default
- per-stage model settings
- explicit fallback rules
- persistence in `input_snapshot_json.model_policy`

### Ticket 1.34c
Define stage-level model policy profiles:
- classification_fast
- summary_fast
- research_strong
- discovery_strong
- drafting_strong
- repair_fast
- env-backed concrete model resolution

### Ticket 1.34d
Define prompt/schema/rule/retrieval versioning:
- prompt template keys and versions
- output schema versions
- validation rule ids and versions
- retrieval policy versions
- checksums and artifact references for agent runs

### Ticket 1.34e
Define prompt/schema/rule registry location:
- repo/config as source of truth in MVP
- Postgres per-run refs/artifacts only
- no DB-backed prompt registry in MVP
- future conditions for DB-backed registry

### Ticket 1.34f
Define campaign guidance injection:
- `campaign_context` shape
- prompt assembly rule
- forbidden claims in prompt and validation
- guidance hierarchy
- campaign-conditioned RAG retrieval

### Ticket 1.34g
Define RAG usage model for ADK stages:
- pre-retrieval default
- bounded runtime RAG tools
- positive/negative corpus separation
- retrieval persistence in snapshots/artifacts
- stage-specific RAG permissions

### Ticket 1.34h
Define web/source tool budget model:
- search/fetch budget fields
- hard stop behavior
- source tool artifact persistence
- search vs fetch separation
- source quality tags
- stage limits for source tools

### Ticket 1.34i
Define source evidence to verified facts pipeline:
- evidence record shape
- proposed fact shape
- deterministic fact validation
- fact statuses
- final confidence and `safe_for_copy` rules

### Ticket 1.34j
Define research facts/evidence schema:
- `research_snapshots`
- `research_facts`
- `research_evidence`
- `research_fact_evidence`
- `research_contact_candidates`
- `draft_claim_fact_refs`

### Ticket 1.34k
Define draft used-fact validation:
- `used_fact_refs`
- `unsupported_claims`
- `soft_claims`
- fact ownership and `safe_for_copy` checks
- `draft_claim_fact_refs` creation
- repair vs `needs_research` behavior

### Ticket 1.34l
Define draft claim classification rules:
- generic offer claims
- company-specific claims
- metric/technical/market claims
- soft personalization
- CTA
- unsupported/unclear claims
- uncertainty to `needs_review`

### Ticket 1.34m
Define draft claim support schema:
- `draft_claims`
- `draft_claim_fact_refs`
- claim categories
- validation statuses
- support types
- draft-version ownership

### Ticket 1.34n
Implement Python ADK runner integration:
- worker invokes Python ADK stage runtime
- maps job/job_run to agent_run
- passes materialized input snapshot
- receives structured output
- captures runtime session/trace refs

### Ticket 1.34o
Implement job-to-agent adapter:
- create agent_run before invocation
- persist input_snapshot_json
- enforce model policy resolution
- enforce stage tool allowlist
- call ADK runtime adapter
- persist output_json and validation metadata

### Ticket 1.34p
Implement agent event/artifact persistence:
- ADK event stream to agent_run_events
- tool results to agent_run_artifacts
- prompt context artifacts
- repair artifacts
- source/RAG retrieval artifacts

### Ticket 1.34q
Implement agent output validation adapter:
- schema validation
- stage-specific validation
- safety/fact validation
- commit_plan construction
- invalid-output routing to repair/outcome handling

### Ticket 1.35
Define `agent_runs.input_snapshot_json` schema:
- model policy
- entity refs
- stage-specific materialized context
- tool allowlist
- output schema name
- validation rules
- exclusions for secrets and large raw artifacts

### Ticket 1.36
Define `agent_runs.output_json` and validation pipeline:
- raw output
- normalized output
- validation metadata
- commit plan
- invalid output handling
- one bounded repair attempt for formatting/schema issues

### Ticket 1.37
Define bounded ADK repair-loop rules:
- allowed repair classes
- disallowed factual/safety repair classes
- max repair attempts
- repair artifacts
- stage-specific repair behavior

### Ticket 1.38
Define `agent_run_outcome` model:
- outcome enum
- outcome reason/payload fields
- distinction from job status
- normal non-success workflow outcomes
- technical failure boundaries

### Ticket 1.39
Define `AgentOutcomeRouter`:
- routing rules for each `agent_run_outcome`
- work item creation rules
- command/job follow-up rules
- event emission rules
- policy blocker behavior

### Ticket 1.40
Define stage-specific AgentOutcomeRouter rules:
- route by `stage_name + outcome`
- transaction boundaries
- domain writes
- work item creation
- follow-up commands/jobs

### Ticket 1.41
Implement MVP AgentOutcomeRouter routing matrix:
- campaign discovery routes
- organization research routes
- contact selection routes
- cold draft routes
- reply classification routes
- warm draft routes
- thread summary routes

### Ticket 1.42
Define ADK session/state policy:
- one bounded session per `agent_run`
- runtime-local state only
- Postgres-backed product truth
- ADK MemoryService excluded from MVP long-term memory
- event stream persistence in `agent_run_events`

## Epic 2: Resend Integration

### Ticket 2.1
Implement outbound Resend client with:
- payload snapshot storage
- provider id persistence
- header linkage support

### Ticket 2.1a
Implement `outbound_messages` send-intent and send-result model:
- reserved row on approved send
- stable idempotency key
- payload snapshot
- provider message id
- send and delivery statuses
- failure class and failure message

### Ticket 2.1b
Implement `job.send_email` pipeline:
- lease reserved outbound message
- re-run final hard guardrails
- persist stable payload snapshot before provider call
- call Resend with stable idempotency key
- persist provider id on success
- emit `outbound_sent` only after confirmed provider acceptance

### Ticket 2.1c
Implement minimal approved-send hard guardrails for provider smoke:
- active suppression check
- valid recipient check
- duplicate send/idempotency check
- exact draft version check
- no unresolved thread/send ambiguity
- no known unsupported central claim
- this is the early subset of the full guardrail evaluator

### Ticket 2.1d
Implement ambiguous send handling:
- detect uncertain provider acceptance cases
- mark `send_ambiguous`
- avoid blind retry
- create operator-visible work item
- add bounded reconciliation using provider idempotency key or provider events

### Ticket 2.2
Implement raw inbound webhook ingress receiver with:
- signature verification
- raw payload/header persistence
- minimal provider event-kind extraction for dedupe, routing, and pending send-hold checks
- dedupe handling
- enqueue `job.process_webhook_event`
- no attachment extraction, matching, classification, final suppression mutation, or other heavy domain processing inline

### Ticket 2.2a
Implement raw webhook event persistence and processing status flow:
- received
- duplicate_ignored
- queued_for_processing
- processing
- processed
- processing_failed
- dead_lettered

### Ticket 2.2b
Implement webhook dedupe-key strategy:
- provider event id when available
- provider message id + event type + provider timestamp
- canonical raw body hash fallback
- no duplicate business events, inbound messages, suppression entries, or delivery updates

### Ticket 2.3
Implement provider event ingestion for send/delivery states with idempotency.

### Ticket 2.3a
Implement provider delivery/status event application:
- resolve existing `outbound_message`
- update send/delivery status without downgrading stronger states
- create suppression for complaint and hard bounce
- create urgent work item or notification for serious delivery/compliance events
- create reconciliation work item for unmatched provider events

### Ticket 2.3b
Implement webhook ingress contract:
- verify
- persist raw event
- dedupe
- enqueue processing
- return fast success

### Ticket 2.3c
Implement ambiguous-send resolution from provider events:
- match provider confirmation to `send_ambiguous` outbound message
- move to confirmed sent/delivered/bounced/complained state
- resolve reconciliation work item when provider acceptance is confirmed
- keep unresolved ambiguous sends operator-visible after reconciliation window

### Ticket 2.4
Implement transient retry policy for outbound send failures.

### Ticket 2.5
Implement automatic suppression transitions from:
- provider unsubscribe event
- complaint
- hard bounce

## Epic 3: Discovery, Research, and Contact Selection

### Ticket 3.1
Implement `CampaignDiscoveryService` job:
- load campaign context
- invoke ADK campaign discovery stage
- validate discovered organization candidates
- apply deterministic dedupe/policy gate
- persist discovery candidates
- enqueue organization enrichment within campaign caps
- create review work items when needed

### Ticket 3.2
Implement organization dedupe service:
- canonical domain/URL matching
- provider/source id matching
- medium company/profile matching
- weak/conflicting match review item
- campaign candidate linkage

### Ticket 3.3
Implement `OrganizationResearchService` job:
- load organization/campaign context
- invoke ADK organization research stage
- persist research snapshot
- persist facts/evidence/contact candidates
- route enriched/needs_review/needs_research/rejected_by_policy outcomes

### Ticket 3.4
Implement contact candidate promotion service:
- normalize contact identity/email
- verify organization match
- check role/title fit
- check reachability confidence
- check suppression/duplicates
- persist promoted contacts and retained candidates

### Ticket 3.5
Implement `ContactSelectionService` job:
- load candidates, contacts, policy state, and prior history
- invoke ADK contact selection stage when needed
- select one primary contact or route no_actionable/needs_review/blocked outcomes
- persist fallback contacts
- enqueue cold draft generation only after gate passes

### Ticket 3.6
Implement cold draft generation gate:
- active campaign
- enriched organization
- selected primary contact
- passing policy checks
- no active-thread conflict
- usable research snapshot

## Epic 4: Threading and Reply Intelligence

### Ticket 4.1
Implement headers-first thread matching.

### Ticket 4.1a
Implement inbound match outcome routing:
- `matched_strong`
- `matched_medium`
- `ambiguous`
- `unmatched`
- classification only after successful attach

### Ticket 4.2
Implement heuristic fallback:
- same domain
- normalized subject
- recent active thread window

### Ticket 4.2a
Implement medium-confidence auto-attach rules:
- allow only exactly one candidate
- require no organization or participant conflict
- persist match method and confidence
- otherwise route to ambiguous manual triage

### Ticket 4.3
Implement manual triage state for ambiguous inbound replies.

### Ticket 4.3a
Implement unmatched inbound work item flow:
- keep inbound inspectable
- show candidate organizations/threads when available
- allow manual attach
- block classification and warm drafting until attached

### Ticket 4.4
Implement participant expansion within an existing company thread.

### Ticket 4.4a
Implement `attach_inbound_to_thread` command:
- verify inbound is not attached to another thread
- attach inbound to selected thread
- optionally add participant
- resolve ambiguous/unmatched work item
- emit manual match event
- enqueue reply classification

### Ticket 4.5
Implement inbound reply intent classification:
- positive_interest
- question
- neutral
- not_now
- wrong_person
- negative
- unsubscribe
- auto_reply_or_noise

### Ticket 4.5a
Implement worker-side processing for persisted webhook events:
- parse inbound email events
- parse delivery/provider events
- extract inbound attachment metadata
- update domain state only after ingestion persistence

### Ticket 4.6
Implement referred-contact extraction and reassignment preparation for `wrong_person` replies.

### Ticket 4.7
Implement deferred `not_now` handling with persisted retry/cooldown date.

### Ticket 4.8
Implement special reply class routing:
- `unsubscribe` creates suppression and notification
- `wrong_person` creates reassignment work item
- `not_now` persists deferred retry/cooldown state
- `auto_reply_or_noise` avoids warm drafting
- low-confidence classification routes to manual review

### Ticket 4.9
Implement `ThreadSummaryService`:
- run as bounded ADK stage using extract -> summarize -> validate flow
- create `agent_runs` and `agent_run_events`
- persist validated thread summary artifact
- emit `thread_summary_refreshed`
- support `refresh_thread_summary` command and `job.refresh_thread_summary`
- fail closed with stale/empty summary rather than blocking thread inspection

## Epic 5: Drafting and Feedback

### Ticket 5.1
Implement draft generation pipeline for cold outreach.

### Ticket 5.2
Implement warm reply draft generation for safe reply classes only.

### Ticket 5.2a
Enforce warm draft generation gate:
- only `positive_interest`, `question`, and `neutral` auto-create warm drafts
- block warm drafts for unmatched or ambiguous inbound
- block warm drafts for risky reply classes

### Ticket 5.3
Implement versioned draft storage and canonical approved version linkage.

### Ticket 5.4
Implement manual edit flow.

### Ticket 5.5
Implement AI revise flow.

### Ticket 5.6
Implement Research More flow as separate research pass.

### Ticket 5.7
Implement feedback tags + free-text notes capture.

### Ticket 5.7a
Implement explicit and implicit feedback capture:
- approve as-is
- approve after edit
- reject
- skip
- revise request
- research-more request
- manual edit
- claim removal
- warning override
- source reviewed

### Ticket 5.7b
Implement deterministic edit severity classification:
- none
- minor
- moderate
- major
- rewrite
- subject/body/claim/CTA/tone/personalization change signals

### Ticket 5.8
Implement rule-based quality score and reason tags persistence.

### Ticket 5.9
Implement draft-level autosend readiness annotation.

### Ticket 5.9a
Implement draft-level autosend readiness labels:
- not_ready
- low_confidence
- promising
- high_confidence
- blocked_by_policy
- blocked_by_facts
- annotation only; no send control in MVP

## Epic 6: Dashboard MVP

### Ticket 6.1
Build SSR `Inbox` page as priority work queue.

### Ticket 6.1a
Define `work_items` schema:
- type
- status: open, snoozed, blocked, resolved, dismissed, superseded
- priority band
- source entity
- lineage refs
- title/summary/reason/action label
- available/due/resolved timestamps
- dedupe key

### Ticket 6.1b
Implement work item lifecycle transitions:
- open to snoozed
- open to blocked
- open to resolved
- open to dismissed
- open to superseded
- snoozed resurfacing by available_at
- audit fields for resolution/dismissal

### Ticket 6.1c
Implement Inbox priority bands:
- `p0_urgent`
- `p1_high`
- `p2_normal`
- `p3_low`
- sort by priority, available time, warm-before-cold, due/age, campaign priority, created time

### Ticket 6.1d
Implement work item dedupe and superseding:
- stable dedupe keys per work item type
- update existing open items instead of duplicating
- supersede old draft review items after new draft version
- resolve ambiguous inbound after manual attach
- resolve ambiguous send after provider confirmation

### Ticket 6.1e
Implement batchable vs non-batchable Inbox grouping:
- non-batchable urgent/compliance/reply/send ambiguity items stay separate
- batch cold drafts by campaign or organization
- batch research-needed and follow-up eligible items
- collapse older dependent items inside the same thread

### Ticket 6.2
Build SSR `Thread View` with:
- header
- timeline
- active review panel
- research/context panel
- policy controls

### Ticket 6.2a
Add Draft Review Panel claim safety UI:
- top-level claim safety badge
- expandable claim map
- risky claim inline indicators
- claim details with status, category, confidence, and support type
- links from claims to supporting facts and evidence

### Ticket 6.2b
Add approve/send gating based on claim safety:
- hard-block unsupported central company-specific, metric, technical, and market claims
- require single-draft inspection for `needs_review`
- require explicit confirmation or edit for `weak_support`
- avoid noisy UI for generic offer and CTA claims marked `not_required`

### Ticket 6.2c
Add risky claim operator actions:
- `Research More`
- `Edit Manually`
- `Revise with AI`
- `Remove Claim`
- `Open Sources`
- persist each state-changing action through the command system

### Ticket 6.2d
Define Draft Review Panel command semantics:
- `Research More` creates enqueue-only `request_research_more`
- `Revise with AI` creates enqueue-only `request_ai_revise`
- manual edit save creates immediate `request_manual_edit_save`
- `Remove Claim` is a manual edit save with an edited draft body
- `Open Sources` is read-only and does not create a command in MVP
- every new draft version triggers claim revalidation

### Ticket 6.2e
Build SSR `Organization Detail View` with:
- company summary
- linked campaigns
- outreach history
- contacts / participants
- outcomes and stats
- restrictions / suppression / cooldowns
- latest research snapshot

### Ticket 6.2f
Implement Organization Detail read model:
- assemble from domain tables and `event_log`
- do not create second CRM truth store
- support optional campaign filter
- expose highest-priority next action

### Ticket 6.2g
Implement Organization Detail lifecycle and outcome labels:
- discovered
- enriched
- contact selected
- draft ready
- sent awaiting reply
- positive/question/not-now/wrong-person/negative
- unsubscribed/bounced/complained
- no actionable contact
- closed manually

### Ticket 6.2h
Implement Organization Detail stats:
- research pass count
- contact candidates found
- drafts generated/approved/rejected
- manual edits
- sends requested/confirmed
- bounces/complaints
- replies by class
- warm drafts and warm sends

### Ticket 6.2i
Implement Organization Detail panels:
- contact and participant panel
- contact candidates vs promoted contacts
- research facts/evidence panel
- suppression/policy panel
- event-log-backed business timeline
- related work items panel

### Ticket 6.3
Build `Policies` page for:
- suppression
- cooldowns
- manual overrides
- compliance flags

### Ticket 6.4
Add expanded editor mode inside Thread View.

### Ticket 6.5
Add thread-level actions:
- approve/send
- hold
- reassignment
- close
- suppress

### Ticket 6.6
Add ambiguous inbound triage UI:
- inspect unmatched inbound
- inspect candidate threads
- attach manually
- resolve or dismiss work item

## Epic 7: Policy and Guardrails

### Ticket 7.1
Implement suppression checks before send.

### Ticket 7.1a
Define suppression model:
- contact scope
- organization scope
- domain scope
- reasons: unsubscribe, complaint, hard_bounce, manual_do_not_contact, compliance
- idempotent creation by scope and reason

### Ticket 7.1b
Define policy state model:
- cooldown
- retry_after
- manual_hold
- manual_override
- compliance_flag
- effective/expiry/resolution fields

### Ticket 7.1c
Implement deterministic guardrail evaluator:
- inputs for action/entity/policy/claim/idempotency state
- outputs `allow`, `warn_confirm`, or `block`
- structured reasons and blocking ids
- advisory messages

### Ticket 7.1d
Implement approve/send command handler:
- validate exact draft version
- validate claim safety
- run synchronous hard guardrails
- reserve `outbound_message`
- append approval event
- enqueue `job.send_email`
- never call Resend from the command handler

### Ticket 7.1e
Implement approval/send timeline semantics:
- show approval separately from sent email
- show send attempt only when worker starts send
- show confirmed sent only after provider acceptance
- show later delivery, bounce, or complaint from provider events

### Ticket 7.2
Implement one-active-thread-per-company enforcement.

### Ticket 7.2a
Implement hard-block guardrails:
- active suppression
- pending unprocessed suppression-class webhook event for the recipient
- compliance flag
- invalid recipient
- duplicate send conflict
- unresolved thread ambiguity
- unresolved send ambiguity
- one-active-thread violation
- stale draft version
- missing/stale claim safety
- unsupported central claim
- closed campaign for cold expansion

### Ticket 7.3
Implement outbound idempotency guard.

### Ticket 7.4
Implement inbound dedupe guard.

### Ticket 7.4a
Implement operator-command idempotency for:
- approve/send
- manual edit save
- AI revise
- research more
- manual attach

### Ticket 7.5
Implement cold vs warm pre-send policy buckets.

### Ticket 7.6
Implement recipient-local timing advisory.

### Ticket 7.7
Implement follow-up eligible detection as work item.

### Ticket 7.8
Implement durable policy-state persistence for:
- cooldown
- retry-after
- manual hold
- manual override
- compliance flag

### Ticket 7.8a
Implement manual override constraints:
- override only allowed warning or temporary policy states
- never override unsubscribe, complaint, hard bounce, compliance hard block, duplicate send conflict, or unsupported central claim
- persist operator, reason, scope, expiry, and overridden policy state

### Ticket 7.8b
Implement policy blocker work items:
- policy blocker by policy state
- suppression blocker by suppression entry
- duplicate-send blocker
- claim-safety blocker
- next valid action per blocker type

### Ticket 7.9
Implement resurfacing of deferred work:
- not_now retry date reached
- cooldown expired
- follow-up eligible becomes visible in Inbox

### Ticket 7.9a
Implement policy-state resurfacing:
- cooldown expired
- retry-after reached
- not-now follow-up eligible
- manual hold expired
- dedupe resurfacing work items

## Epic 8: Notifications and Ops

### Ticket 8.1
Implement Telegram urgent notifications:
- inbound reply
- ambiguous reply
- serious failure
- unsubscribe/complaint/bounce
- reassignment-needed
- desktop/local dashboard deep links
- mobile Telegram may be informational-only

### Ticket 8.2
Implement Telegram summary notifications for draft-ready batches.
- include links to local Inbox filters or dashboard views where available
- avoid implying mobile deep links are fully actionable in MVP

### Ticket 8.3
Implement event log-backed timeline rendering.

### Ticket 8.4
Implement operational counters in dashboard header/inbox.

### Ticket 8.4a
Implement ops counters for:
- open P0/P1 work items
- failed/exhausted jobs
- stale leased jobs
- webhook processing failures
- send ambiguous count
- pending draft reviews
- pending warm replies
- pending research-needed items
- background indexing backlog
- last successful worker heartbeat

### Ticket 8.5
Implement failed-job and blocked-item visibility.

### Ticket 8.6
Document local runbook:
- required env vars
- compose startup
- migrations
- seed/test data if any
- webhook local testing strategy
- failed-job inspection
- safe replay/requeue
- safe shutdown
- backup/restore for Postgres and artifact volumes
- backup files must not be committed
- old backup deletion guidance

### Ticket 8.7
Implement worker graceful shutdown behavior:
- stop leasing new jobs
- finish or safely release in-flight jobs when possible
- rely on lease expiry for interrupted jobs
- avoid marking process-stop as domain failure

## Epic 9: RAG / Memory Layer

### Ticket 9.1
Define which artifacts are embeddable:
- approved cold drafts
- approved warm replies
- rejected drafts
- operator feedback notes
- selected thread summaries

### Ticket 9.2
Implement embedding generation jobs.

### Ticket 9.3
Implement local vector retrieval service.

### Ticket 9.4
Implement retrieval pipeline:
- structured narrowing
- semantic search
- quality-aware rerank

### Ticket 9.5
Inject retrieved memory into drafting/reply generation context.

### Ticket 9.6
Implement `pgvector` schema and `HNSW` indexing for curated RAG documents.

### Ticket 9.7
Split RAG retrieval into positive corpus and negative corpus handling.

### Ticket 9.8
Implement learning artifact routing:
- positive corpus
- negative corpus
- neutral/audit-only artifacts
- exclusion rules for unsafe or disputed artifacts

### Ticket 9.9
Implement feedback summary generation for RAG:
- successful pattern summaries
- anti-pattern summaries
- campaign/pillar/contact-type metadata
- original feedback reference preservation

### Ticket 9.10
Implement background learning/indexing triggers:
- draft approved
- manual edit saved
- draft rejected/skipped
- outbound sent
- reply classified
- complaint/bounce/unsubscribe received
- thread closed
- feedback note added
- quality score updated
