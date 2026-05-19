# BizDev Outreach MVP Implementation Plan

Phases describe implementation order.

Ticket epics describe workstream ownership and may span phases.

## Phase 0: Foundation

Goal:
- lock architecture, schema, and runtime boundaries before coding feature loops

Deliverables:
- canonical design doc
- finalized stack decision
- pinned Docker/base image and package-manager versions during scaffold
- schema draft
- service boundary map
- event taxonomy
- command/job/event vocabulary
- orchestration model for event-driven stage handlers
- command-handler vs worker boundary rules
- immediate-transition vs enqueue-only command map
- Telegram secondary command-surface boundary
- shared `commands` table model
- jobs-table leasing and concurrency model
- job-runs execution history model
- event-log vs technical-telemetry boundary
- event-log field model and indexing rules
- correlation model without trace/span split
- correlation-id creation and inheritance rules
- jobs-as-outbox rule for external side effects
- job-class risk model
- retry policy by job class and job type
- concurrency-key and conflict-domain model
- multi-pool worker scheduling model
- concrete MVP worker-pool assignment
- boundary between core worker orchestration and external agent frameworks
- agentic vs deterministic stage-service split
- ADK worker-agent runtime
- Python ADK worker runtime and direct Gemini/model API mode
- explicit split between system orchestrator and stage-level agent orchestrator
- ADK-first assumption for agentic stage workflows
- ADK primitive mapping for agentic worker stages
- framework-neutral agent-run persistence model
- ADK tool boundary and guardrails
- ADK per-stage toolsets
- external source tooling model
- ADK model/provider policy
- stage-level model policy profiles
- prompt/schema/rule/retrieval versioning
- repo/config registry source of truth
- campaign guidance injection into ADK prompts
- RAG usage model for ADK stages
- web/source tool budget model
- source evidence to verified facts pipeline
- research facts/evidence data model
- draft used-fact validation
- draft claim classification rules
- draft claim support data model
- agent-run input snapshot model
- agent-run output and validation model
- bounded ADK repair-loop rules
- agent-run outcome model
- deterministic AgentOutcomeRouter model
- AgentOutcomeRouter stage/outcome routing rules
- MVP AgentOutcomeRouter routing matrix
- ADK session/state boundary
- campaign model and campaign-to-outreach relationship
- campaign lifecycle and pause/resume semantics
- campaign start/expansion model
- campaign readiness validation
- campaign expansion caps and bounded expansion tick
- campaign status command/job gating
- discovery candidate lifecycle and organization dedupe rules
- contact candidate promotion rules
- contact selection outcomes and draft-generation gate

Exit criteria:
- no unresolved contradictions around mailbox, review surface, send control, or RAG role

## Phase 1: Core Runtime and Data Layer

Goal:
- create the minimum trustworthy backend foundation

Deliverables:
- Docker Compose runtime for dashboard, worker, and Postgres
- named volumes for Postgres and local artifacts
- env/secrets configuration contract
- security/privacy/data-retention contract
- RAG eligibility and redaction rules
- health checks and schema compatibility checks
- local runbook
- Postgres schema via Drizzle
- repositories/services for campaigns, organizations, contacts, outreach_records, drafts, threads, messages, suppression, policy-state, work-items, and events
- idempotency registry
- event log
- event-log field and inclusion rules
- event-log indexing and lineage fields
- shared `correlation_id` propagation rules
- root-flow vs inherited-flow correlation rules
- commands table / command handlers
- jobs table / leasing model
- job_runs table / attempt history model
- worker skeleton
- webhook ingress skeleton
- event-driven stage handler map
- immediate-transition vs enqueue-only command map
- shared commands-table lifecycle and causality model
- jobs retry/backoff/concurrency-key model
- transactional state-change plus side-effect-job creation pattern
- job-class-specific retry and visibility model
- reconcile-vs-retry handling for ambiguous external jobs
- conflict serialization for worker execution
- worker-pool-specific polling and concurrency caps
- exact job-type assignment for urgent / drafting / background pools
- Python ADK integration for agentic worker stages
- ADK MCP tool integration boundary
- agent_runs / agent_run_events / agent_run_artifacts schema
- typed ADK tool allowlists and artifact persistence
- stage-specific ADK tool allowlist implementation
- external source tools for web/search/provider integrations
- ModelPolicyResolver and per-stage model policy
- env-backed model profile resolution
- prompt/schema/rule/retrieval registry references in agent runs
- repo-based prompt/schema/rule/retrieval registry
- materialized campaign_context assembly
- pre-retrieval and runtime RAG tool persistence
- source tool budget and artifact persistence
- proposed facts, evidence refs, and deterministic fact validation
- research snapshots/facts/evidence/contact-candidate tables
- used_fact_refs / unsupported_claims validation for drafts
- generic vs company-specific claim validation
- draft_claims and draft_claim_fact_refs tables
- input_snapshot_json schema for agent runs
- output_json schema and validation pipeline for agent runs
- repair-loop artifact and limit rules
- agent_run_outcome storage and status mapping rules
- outcome-to-work-item/command/job/event routing
- transactional AgentOutcomeRouter implementation
- code-level routing matrix for agent stages
- ADK session lifetime and MemoryService exclusion rules
- explicit exclusion of Vertex AI Agent Engine from MVP
- boundary rules between ADK stage execution and Postgres-backed domain truth
- stage-service inventory for MVP

Exit criteria:
- service layer can create and update all main entities
- command handlers can enforce idempotency and write events
- command/job/event boundaries are explicit in code and schema
- heavy work is isolated to worker execution paths

## Phase 2: Inbound/Outbound Email Integration

Goal:
- make mailbox identity work end-to-end with Resend

Deliverables:
- Resend outbound integration
- Resend inbound webhook ingestion
- thin webhook ingress handlers
- raw webhook event table and processing status flow
- webhook dedupe-key strategy
- outbound header/thread linkage
- inbound raw storage
- duplicate-safe provider event processing
- automatic suppression transitions for provider complaint / hard bounce / unsubscribe events
- recipient-level send hold fast-path for pending complaint / hard bounce / unsubscribe webhook events before async worker reconciliation
- minimal hard-block pre-send guardrails required for approved send smoke
- outbound_message reservation and payload snapshot storage
- send ambiguity reconciliation path
- provider delivery event status updates
- unmatched provider event reconciliation work items

Exit criteria:
- send one operator-approved cold email through worker/provider path
- receive one reply into the same system
- persist inbound reply for later worker processing
- webhook ingress returns quickly after verify/persist/enqueue without inline heavy processing

## Phase 3: Dashboard MVP

Goal:
- give the operator a usable local review surface

Deliverables:
- `Inbox`
- `Organization Detail View`
- `Thread View`
- `Policies`
- organization read model from domain tables and event history
- organization stats and outcome labels
- organization timeline and next-action panel
- draft review panel
- claim safety summary in draft review
- claim-to-source inspection from draft review
- approve/send gating for unsupported central claims
- context/research panel
- work queue prioritization
- work item priority bands and dedupe keys
- work item superseding rules
- batchable vs non-batchable Inbox grouping
- policy actions
- ambiguous inbound triage flow

Exit criteria:
- operator can review a cold draft, inspect a thread, inspect an organization, handle a reply, and apply suppression from the dashboard

## Phase 4: Drafting and Review Loop

Goal:
- connect generation and operator feedback to the runtime

Deliverables:
- draft generation service
- manual edit flow
- AI revise flow
- research more flow
- versioned draft history
- feedback tags and notes
- quality score scaffolding
- autosend readiness annotation
- explicit and implicit feedback capture
- edit severity classification
- positive/negative/neutral learning artifact routing
- operator-command idempotency for send/edit/revise/research-more/manual-attach
- review-panel command semantics for research-more, AI revise, manual edit, claim removal, and read-only source inspection
- claim revalidation after every new draft version

Exit criteria:
- complete `draft -> review -> send` cycle with version history and feedback captured

## Phase 5: Notifications and Guardrails

Goal:
- reduce operator latency without losing control

Deliverables:
- Telegram summary and urgent notifications
- Telegram-to-command integration boundary
- pre-send guardrail engine
- pending unprocessed suppression-class webhook event blocking
- approve/send command-to-job pipeline
- deterministic policy evaluator
- suppression vs temporary policy-state separation
- manual override constraints
- policy blocker work item generation
- cold vs warm send policies
- timing advice
- retry policies
- follow-up eligible work item generation
- cooldown / retry-after resurfacing
- durable policy-state persistence

Exit criteria:
- urgent replies notify properly
- unsafe sends are blocked or require confirmation

## Phase 6: RAG and Learning Memory

Goal:
- make prior examples and feedback reusable without making them workflow truth

Deliverables:
- curated embedding pipeline
- `pgvector`-backed local vector memory
- retrieval service
- structured narrowing + semantic retrieval + quality-aware ranking
- prompt context assembly from prior examples
- positive and negative retrieval corpora
- `HNSW` indexing strategy
- feedback summary generation for RAG
- background learning/indexing jobs

Exit criteria:
- generation can use relevant prior drafts/replies/feedback as memory context
- rejected drafts contribute to anti-pattern memory without polluting the positive reference set

## Phase 7: Hardening

Goal:
- make MVP stable enough for sustained real usage

Deliverables:
- replay-safe webhook handling
- recovery flows for unmatched inbound and send ambiguity
- counters in dashboard
- operational counters for worker heartbeat, stale leases, failed jobs, webhook failures, ambiguous sends, and indexing backlog
- operational visibility for failed jobs and policy conflicts
- documentation for runtime and local ops
- backup/restore notes for Postgres and artifact volumes

Exit criteria:
- operator can run the system daily without shell-driven debugging for normal cases
