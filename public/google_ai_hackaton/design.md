# CitizenWeb3 AI Operations Platform — Design Document

**Repositories:**
- [`citizenweb3/ai-integrations`](https://github.com/citizenweb3/ai-integrations) — branches [`telegram-growth-agent-vertex`](https://github.com/citizenweb3/ai-integrations/tree/telegram-growth-agent-vertex) (Aida), [`bizdev-email-agent`](https://github.com/citizenweb3/ai-integrations/tree/bizdev-email-agent) (BizDev), [`logos-onboarding-assistant`](https://github.com/citizenweb3/ai-integrations/tree/logos-onboarding-assistant) (Logos)
- [`citizenweb3/validatorinfo`](https://github.com/citizenweb3/validatorinfo) — ValidatorInfo

---

## Table of contents

1. [What we built and why it matters](#1-what-we-built-and-why-it-matters)
2. [The four surfaces at a glance](#2-the-four-surfaces-at-a-glance)
3. [Architecture and interconnections](#3-architecture-and-interconnections)
4. [Orchestration patterns (how quality is produced)](#4-orchestration-patterns-how-quality-is-produced)
5. [Per-surface deep summary](#5-per-surface-deep-summary)
6. [Tech stack — canonical single-source table](#6-tech-stack--canonical-single-source-table)
7. [Production runtime properties](#7-production-runtime-properties)

---

## 1. What we built and why it matters

CitizenWeb3 operates a validator-analytics platform (ValidatorInfo), a live community on Telegram, a BizDev pipeline that brings new networks and validators onto the platform, and a separate product chain (Logos) with its own onboarding journey. The work that scales with these channels — answering operator and delegator questions on real-time on-chain data, summarising governance for non-experts, explaining what a podcast guest argued for, qualifying outbound prospects with evidence-backed research, growing the community without spamming it, onboarding new chain users without fabricating product features — does not scale with headcount. We automated it.

At the centre sits **ValidatorInfo**. It is two things at once:

- **A user-facing AI product** that makes the platform legible to people who would otherwise bounce. A delegator on a validator profile page asks "is this validator's commission rising?" and the chat answers from live on-chain Postgres using the typed validator tool, not from a stock LLM. A non-expert opens a governance proposal and gets a locale-aware 2–3-sentence explanation in plain language with no markdown clutter. A potential client browsing the podcast section reads a 500–1000-word summary of a guest's positions; a question about "what does the host think about liquid staking" hits a 7-topic host-meta corpus that aggregates the host's positions across the entire back catalogue and is queryable through the same RAG endpoint Aida uses. Every page on the product has an "Explain this page" entry point that opens the chat pre-loaded with the page's context.
- **The knowledge hub the rest of the platform grounds in.** Aida already calls `query_validatorinfo` (read-only on-chain Postgres SELECT) and `search_rag` (HTTP `/api/rag/search` over the podcast + host-meta corpora + CW3 knowledge base) on every reply that ships through its pipeline. BizDev will consume the same two surfaces on the roadmap. One canonical truth — live state + indexed CitizenWeb3 knowledge — fans out to every agent that touches a customer.

Around this hub three more agents automate distinct channels: **Aida** grows the Telegram community by joining only the threads that need a domain answer (intentionally low reply rate, scored via a proactive scanner) and grounds every reply in ValidatorInfo's two endpoints. **BizDev** runs the full outbound email loop end-to-end with evidence-backed research, claim validation, RFC822-correct threading, and a 10-class reply classifier. **Logos** answers onboarding questions from indexed docs with citations, never fabricating a feature.

All four run on **one Google Cloud project**, **one Vertex AI backbone**, **Gemini models** for generation and embedding, and the **Agent Development Kit (ADK)** for the two surfaces that need multi-role agentic orchestration. The operations principle across all four:

> **The model proposes. The pipeline verifies. The operator approves where the decision is high-stakes.**

This is what that produces in practice:

- **No fabrication.** Every send-path artifact (Aida message, BizDev email) passes a code-enforced gate — not a prompt instruction — that fails if the verification call made zero tool calls or if a claim has no `factId` traceable to indexed evidence. The model cannot rationalize past these gates with prose.
- **Evidence-grounded reasoning.** BizDev's research facts require `evidence[*].sourceUrl` from real `google_search` results and explicitly reject Vertex grounding redirect URLs. Logos renders citation chips from real chunk IDs. ValidatorInfo's chat returns structured tool data, not free-form prose pretending to be data.
- **Operator-in-the-loop where the decision matters.** Aida posts in `mode: approval` (humans review every draft before it goes to a TG group). BizDev's `approveDraftForSendCommand` runs a 6-class pre-send guardrail engine and routes operators through `/drafts/[id]` for approve/revise/discard. The two read-only surfaces (ValidatorInfo chat, Logos) persist full chat logs with retrieval lineage, model, finish-reason, and latency split for after-the-fact inspection.
- **Auth that cannot silently degrade.** Aida and BizDev both refuse to start if `GOOGLE_API_KEY` is set in the environment — Vertex AI + ADC is the only supported path, no silent fallback to the Developer API or a different billing surface.

The implementation runs in production today. Aida posts on Vertex behind its three-Gate pipeline plus the proactive scanner. BizDev runs the full outreach loop end-to-end — research, contact discovery, draft, AI revise, claim validation, send with RFC822-correct threading, 10-class reply classification, operator dashboard, Telegram operator surface, pre-send guardrails, and the internal-RAG indexing pipeline with its Vertex embedder. Logos serves chat with local-only access, per-IP rate limiting, and full retrieval lineage in the chat log. ValidatorInfo plays a dual role in production. As a product it serves five Vertex-backed AI features (page-context chat, proposal summaries, podcast episode summaries, the 7-topic host-meta corpus, and the "Explain this page" contextual entries). As the platform's knowledge hub it grounds the other agents: Aida already calls `query_validatorinfo` and `search_rag` on every reply that ships; BizDev will consume the same two surfaces on the roadmap.

---

## 2. The four surfaces at a glance

| Surface | What it does | Distinguishing AI mechanism |
|---|---|---|
| **Aida** ([branch](https://github.com/citizenweb3/ai-integrations/tree/telegram-growth-agent-vertex)) | Grows the CitizenWeb3 Telegram community. Reactive replies in topic groups + a 10-minute proactive scanner that scores threads worth joining. Reply rate is intentionally low — skips silently more often than it posts. | Four-role ADK topology (router → reactive → reply → verification) running a deterministic three-stage pipeline. Pipeline counts tool calls in Phase 2 verification and rejects any turn with zero — model cannot claim grounding without leaving evidence in the audit trail. |
| **BizDev** ([branch](https://github.com/citizenweb3/ai-integrations/tree/bizdev-email-agent)) | Runs the outbound email outreach loop end-to-end: prospect discovery, research, contact discovery, draft (cold and warm), operator-feedback revise, claim validation, RFC822-correct send, 10-class reply classification + routing. | Ten dedicated ADK stages (each with own model and own tool allowlist) composing through the data layer. Dedicated verification stages: `research_quality_gate` (reviews without searching), `validate_claims` (claim-to-`factId` mapping). Own pgvector RAG over past drafts labeled positive/negative — successful drafts inform new ones (indexing + Vertex embedding shipped; retrieval at draft-generation time is the next deliverable). |
| **ValidatorInfo** ([repo](https://github.com/citizenweb3/validatorinfo)) | Dual role: (a) the platform's **knowledge hub** — its `/api/rag/search` endpoint and its read-only on-chain Postgres role are the grounding surfaces every other agent calls (Aida shipped, BizDev roadmap); (b) a product with five Vertex-backed AI features inside it — page-context-aware chat with 8 tool modules + AI governance-proposal explanations + 500–1000-word podcast episode summaries + 7-topic host meta-aggregate embedded as a searchable `__host_meta__` corpus + "Explain this page" contextual entry points. | Page-context-aware system prompt (37+ declared page types, runtime injection of chain/validatorId/proposalId) tells the model which tool module to call for which question class. Modules expose typed function tools that return structured data, not prose. Locale-aware proposal summaries cache per locale and retry on sentence-end truncation. The host-meta corpus turns the host's recurring positions into queryable RAG content — both Aida and the in-product chat read from it through the same endpoint. |
| **Logos Onboarding** ([branch](https://github.com/citizenweb3/ai-integrations/tree/logos-onboarding-assistant)) | Production onboarding chat over the Logos chain docs. Indexer ingests four source kinds (GitHub docs, raw repo files, static seed docs, web pages). Chat answers with citations. | Four-step retrieval (query rewrite with conversation history to resolve pronouns → embed → hybrid HNSW + GIN tsvector search → LLM rerank with Zod-schema 0–10 scoring). Citation chips per response from real chunk IDs. Token-streamed deterministic fallback when retrieval is empty — never fabricates a response. |

---

## 3. Architecture and interconnections

```
                  ┌──────────────────────────────────────────────────┐
                  │  Google Cloud project (single)                   │
                  │  ADC + service-account JSON (no API keys)        │
                  │  vertexLocation: 'global'                        │
                  └──────────────────────┬───────────────────────────┘
                                         │
                  ┌──────────────────────┼──────────────────────┐
                  │                      │                      │
            Vertex Gemini         Vertex Embeddings       Vertex Grounding
            2.5/3.5/3 family      001 / 2                 google_search
                                                          (isolated tool)

  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
  │     Aida         │  │     BizDev       │  │  ValidatorInfo   │  │      Logos       │
  │  Python ADK      │  │  Python ADK      │  │  Vercel AI SDK   │  │  Vercel AI SDK   │
  │  4 roles         │  │  10 stages       │  │  + 8 tool modules│  │  4-step retrieval│
  │  3-Gate pipeline │  │  FastAPI NDJSON  │  │  + server action │  │  + LLM rerank    │
  │  10-min scanner  │  │  TS worker pool  │  │  + 5 AI features │  │  + indexer       │
  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
           │                     │                     │                     │
           │ query_validatorinfo │ (roadmap)           │  RAG /api/rag/search│  own RAG silo
           │ search_rag (HTTP)   │ same shape          │  + on-chain Postgres│  logos_chunks
           │                     │                     │  + podcast corpus   │  (independent)
           └──────────┬──────────┴─────────────────────┘                     │
                      │                                                       │
                      ▼                                                       ▼
              ValidatorInfo                                             logos_chunks
              knowledge hub                                             pgvector silo
              (RAG + Postgres                                           HNSW + tsvector
              + own pgvector 768)                                       hybrid index
```

**Aida** is the only surface that reads from ValidatorInfo today. It grounds replies in two ways: `query_validatorinfo` runs read-only SELECT against on-chain Postgres (the same DB ValidatorInfo serves), and `search_rag` calls ValidatorInfo's authed RAG endpoint over HTTP. BizDev will follow the same shape (RAG HTTP + read-only SQL); the integration is roadmap, not in code.

**BizDev** also operates an internal RAG (`retrieveRagContext`) over its own `rag_embeddings` table where past drafts labeled `positive` or `negative` are indexed for retrieval at draft-generation time. This is the platform's learning-memory pattern — successful drafts inform new ones.

**Logos** is a self-contained silo: its `logos_chunks` corpus (GitHub docs + raw repo files + static seed docs + web pages) does not overlap with ValidatorInfo's domain, so a shared knowledge hub would not help. It still rides the same Vertex backbone, same project, same auth.

**ValidatorInfo** serves three roles at once: (1) the knowledge hub Aida (and soon BizDev) consume; (2) a user-facing AI product with five distinct AI features; (3) the indexing host for the podcast and host-meta corpora that the Aida `search_rag` tool queries.

---

## 4. Orchestration patterns (how quality is produced)

Five patterns repeat across the surfaces. Each gets named once here and referenced from the per-surface profiles in §5.

### 4.1 Smart-model verification by pipeline-counted evidence

A weaker / faster model drafts; a stronger or differently-configured model verifies before the artifact ships. The verification gate is enforced in **pipeline code or schema validation**, not in a prompt the model can rationalize around:

- **Aida** Phase 2: counts tool calls in the verification turn. Zero tool calls → `skipped_phase2_no_tools` regardless of what the model claimed.
- **BizDev** `research_quality_gate`: a dedicated ADK stage that reviews `research_snapshot` output without searching. Insufficient → emits follow-up queries for `research_more`. `validate_claims`: extracts every declarative claim from a draft, maps each to a snapshot `factId` with `supportType in {supports, context}`. Empty `factIds` is a visible unsupported-claim signal.
- **Logos** rerank: LLM output validated against a Zod schema `z.object({ rankings: [{ id, score 0–10 }] })`. Invalid output OR LLM call failure → monotone fallback `10 - index`. The reranker cannot silently pass garbage.
- **ValidatorInfo** RAG search: overfetches up to `OVERFETCH_LIMIT` then trims to the requested `limit` so the downstream LLM has headroom without inflating its own context.

### 4.2 Classification + routing inside the pipeline

Structured-output classifiers decide downstream branches:

- **Aida** router on `gemini-2.5-flash-lite` with `response_schema { respond, reason }` decides whether Phase 1 even starts. Two semaphores in the router separate reactive vs proactive concurrency.
- **BizDev** `classify_reply` assigns exactly one of **10 classes** to every inbound: `positive_interest`, `question`, `neutral`, `not_now`, `wrong_person`, `unsubscribe`, `complaint`, `out_of_office`, `auto_reply`, `noise`. Each class drives explicit routing (operator triage / cooldown policy state / thread reassignment / suppression entry / silent auto-handling). `unsubscribe` and `complaint` are conservative by instruction — assigned only on unambiguous intent.

### 4.3 Evidence-grounded reasoning

Every assertion the platform produces traces back to a source it indexed or fetched:

- Aida: Phase 2 must call a tool to send (§4.1). Link emission is forbidden in prompts AND post-checked by `_LINK_RE` regex in `response_pipeline.py`.
- BizDev `research_snapshot`: every fact requires `evidence[*].sourceUrl` from a real `google_search` result with `quoteText < 280 chars`. Vertex grounding redirect URLs (`vertexaisearch.cloud.google.com/...`, `google.com/search?...`, `google.com/url?...`) are explicitly rejected — the worker drops them.
- BizDev `revise_email`: each declarative claim about the target MUST trace back to a `factId` from the snapshot; if operator feedback asks for something the snapshot cannot support, the claim moves to `changeNotes`, not the body.
- Logos: `messageMetadata.sources = ChatSource[]` per response built from real `RerankedChunk.id`s; chat log persists `retrievedIds` so any cited source is verifiable after the fact.
- ValidatorInfo: chat system prompt explicitly tells the model which typed tool to call per question class; tool modules return structured data, not free-form prose.

### 4.4 Per-stage / per-role tool allowlists as a security boundary

Tool exposure is a static manifest, not a runtime negotiation between the model and the dispatcher:

- **BizDev** `_STAGE_TOOLS: dict[str, list[BaseTool]]` declares allowed tools per stage. The list is persisted into `agent_run` inputs so a replay can audit exactly what each stage was allowed to call. `GET /health` surfaces the full allowlist by stage. Real mapping: `research_snapshot` / `research_more` / `contact_candidate_discovery` / `campaign_discovery` → `[google_search]`; `research_quality_gate` / `draft_email` / `draft_warm_email` / `revise_email` / `validate_claims` / `classify_reply` → `[]` (pure prompt-based, no tool calls — snapshot facts are passed in via prompt context).
- **Aida** per-role agents have fixed tool sets at construction (reactive/reply/verification all get `[query_validatorinfo, search_rag, build_web_research_tool()]`); router has no tools; web_research sub-agent is isolated with `[google_search]` only.

### 4.5 Tools as mini-agents

- **Aida** `web_research` is itself an ADK `AgentTool` — a sub-agent on `gemini-3.5-flash` with `[google_search]` and its own instruction ("no URLs in summary — caller cannot send links"). Isolation avoids Gemini's multi-tool exclusivity constraint without losing grounding; URL stripping happens before the parent agent ever sees the result.
- **BizDev** 10 stages compose at the **data layer** (`agent_run_artifact` → next stage input) rather than cramming everything into a single agent. Each stage is its own ADK Agent.

---

## 5. Per-surface deep summary

Each subsection below is the **single canonical place** for surface-specific facts.

### 5.1 Aida (Telegram growth)

Python ADK 2.1 + google-genai 1.75 in-process inside the existing Telethon + aiogram + asyncio runtime. Three ADK Agents built at startup (reactive, reply, verification) plus a router that bypasses ADK and calls `google.genai.generate_content` directly with `response_schema` for latency. All three tool-using agents share the tool set `[query_validatorinfo, search_rag, web_research]` where `web_research` is an isolated sub-agent via `AgentTool` carrying `[google_search]` only.

The **three-Gate pipeline** in `src/core/response_pipeline.py`: pre-Phase 1 hostility / bait-trap guard skips silent without an LLM call; Phase 1 reactive draft skips if `action ≠ "respond"` OR `confidence < 0.7` OR no text; **Rule 1**: ALWAYS run Phase 2 (the previous "conf ≥ 0.9 sends directly" shortcut was removed — Phase 1 confidence on training data alone is not trustworthy); Phase 2 verification with `is_verification=True` on the reply model; **Rule 2 (hard gate)**: if `len(tool_calls2) == 0` → `skipped_phase2_no_tools` regardless of model claim; final gate on `new_action` + `new_conf`. DM intent is preserved across phases. Errors route through `alert_for_error` → approval channel; `LLMHealth` maps `google.auth` / `google.api_core.exceptions` to `auth | rate_limit | server | config | unknown` via `classify_error`; `auth` permanently locks until human intervention.

The **proactive scanner** (`src/ai/proactive.py`) runs every 10 minutes. For each active group: rate-limit check, fetch messages within `proactive.window_minutes` (default 30), filter `responded=False`, filter out messages with an active response (SQL `SELECT DISTINCT in_reply_to FROM responses WHERE status IN ('candidate','pending_approval','queued','sending','sent')`), extract threads by `reply_to_message_id`, score each via `_score_thread` (5 factors weighted to sum 1.0: recency 0.20 + unanswered-question 0.35 + topic-relevance 0.25 + thread-heat 0.10 + novelty 0.10). Top `max_candidates` by score enter the same pipeline as reactive, marked `is_proactive=True`. Router uses a separate `_proactive_sem` semaphore + separate context budget.

Production posture: `assert_vertex_env` at startup AND in `Responder.__init__` (refuses `GOOGLE_API_KEY`); `_static_instruction` wraps role instructions as ADK `InstructionProvider` to bypass `{state}` template injection (the persona file contains literal `{...}` JSON-schema examples); SQL safety in `is_safe_select` with word-boundary `_FORBIDDEN_RE` denylist + `INTO` rejection + 2-stage timeout (`_QUERY_TIMEOUT_FIRST_S=5`, `_QUERY_TIMEOUT_RETRY_S=15`); schema-error enrichment teaches the model to fall back to `search_rag`; `mode: "approval"` canary in config (humans review every draft before it posts). Runs in production on Vertex.

### 5.2 BizDev (email outreach)

Monorepo: `apps/agent` (Python ADK FastAPI service) + `apps/worker` (TS, job leasing + agent dispatcher + Vertex embedder + Resend + Telegram clients) + `apps/dashboard` (Next.js operator UI) + `packages/db` (Drizzle schema + repositories) + `packages/shared` (~1654 lines: commands, events, jobs, error classes). Postgres = `pgvector/pgvector:pg17`.

**Ten ADK stages** (`apps/agent/src/agent/agents.py` `build_agent(stage)`): `research_snapshot`, `research_more`, `research_quality_gate`, `contact_candidate_discovery`, `draft_email`, `draft_warm_email`, `revise_email`, `validate_claims`, `classify_reply`, `campaign_discovery`. Each is its own ADK Agent with its own `instruction` and model resolved per-stage via `resolve_model()` against env keys (e.g., `AGENT_DRAFT_EMAIL_MODEL` → `AGENT_DRAFT_MODEL` → `AGENT_DEFAULT_MODEL` → hard default `gemini-3.5-flash`). Per-stage tool allowlist in `_STAGE_TOOLS` (§4.4). Stage runner (`runner.py`) uses `InMemoryRunner` per call (ephemeral session); extracts Vertex grounding `citation_metadata` (up to 100 citations: `{uri, title, startIndex, endIndex}`) into NDJSON events so the TS DB layer persists them into `agent_run_events`.

**FastAPI ingress** (`apps/agent/src/agent/main.py`): refuses to start if `GOOGLE_CLOUD_PROJECT` or `GOOGLE_CLOUD_LOCATION` missing OR if `GOOGLE_API_KEY` is set. `GET /health` exposes `{stages, tool_allowlist}`. `POST /runs/{stage}` streams NDJSON events; optional `Authorization: Bearer <AGENT_RUN_SECRET>`.

**TS worker layer.** `agentClient.ts` is the HTTP NDJSON dispatcher with a 300s hard timeout (`AGENT_REQUEST_TIMEOUT_SECONDS`) via `AbortController` — protects against Vertex stalls, agent restart mid-run, network drops; on abort, the handler routes through the normal `run_failed` path so `recoverStaleJobs` re-leases cleanly. `vertexRagEmbedder.ts` implements the embedder behind the `RagEmbedFn` interface; supports both `embed_content` (global, `gemini-embedding-2`) and `predict` (regional, `gemini-embedding-001`) transports; asymmetric task types (`RETRIEVAL_DOCUMENT` for indexing, `RETRIEVAL_QUERY` for queries); batched at 25 per call; `NonRetryableJobError` on gRPC 3 / 7 / 9 / 16 or HTTP 4xx non-429. `resendClient.ts` handles outbound + inbound. `telegramClient.ts` wraps Bot API for operator notifications.

**Production data layer** (`packages/db/src/schema.ts` + `repositories.ts`). Commands table + idempotency_registry (every operator/system action is a row, dedupe on `idempotency_key`). Three worker pools (`urgent`, `drafting`, `background`). Lease-based jobs with `leaseNextJob` / `recoverStaleJobs` cron. `agent_runs` / `agent_run_events` / `agent_run_artifacts` persistence with NDJSON event stream. `AgentOutcomeRouter` (`routeResearchSnapshotOutcome`, `routeDraftEmailOutcome`, `routeWarmDraftEmailOutcome`, `routeReviseDraftOutcome`, `routeValidateClaimsOutcome`) writes versioned `research_snapshots` + `research_facts` (confidence rubric `low → 20 / medium → 60 / high → 85`) + `research_evidence` + `research_fact_evidence` transactionally, all in one DB round-trip with `agent_run_artifact` storing raw JSON for reproducibility.

**Drafting and review loop.** Versioned `draft_versions` (source discriminator `operator_created | operator_edited | agent_generated | agent_revised`, sha256 body hash, `claims_validated_version` snapshot, `agent_run_id`, `change_notes`). Append-only `draft_feedback` (implicit capture from manual edit / AI revise / approve + standalone `record_draft_feedback` operator command with idempotency key keyed on tag-hash + note-hash). Quality scoring: `drafts.quality_score` (0..100) + `quality_score_band` (low/medium/high) + `autosend_readiness` (5 labels) + `quality_score_reasons jsonb`; deterministic rule-based `recomputeDraftScores(tx, draftId, correlationId)` hooked at all 7 mutation sites; emits `quality_score_updated` / `autosend_readiness_updated` events only on change. Corpus-label routing for learning memory: every `draft_versions` and `draft_feedback` row carries a `corpus_label` (positive/negative/neutral) with 12-reason whitelist; `recomputeDraftScores` re-routes all versions in the same tx so late feedback flips prior labels. `validate_claims` re-extracts claims after operator edits via `job.revalidate_draft_claims` in the `drafting` pool; `claims_stale` pre-send guardrail blocks approve until `claims_validated_version === drafts.version`. AI revise loop via `request_ai_revise` → `revise_email` ADK stage → `routeReviseDraftOutcome`. Research-more flow via `request_research_more` → `research_more` ADK stage.

**Email integration.** Resend inbound webhook ingestion with `webhook_events.dedupe_key` UNIQUE; automatic suppression on `complaint` / `hard_bounce` / `unsubscribe`. RFC822-correct outbound: every row carries a deterministic `Message-Id` template `<om-<uuid>@<from-domain>>`. For threaded sends, `loadThreadRfc822Chain` aggregates prior outbound + inbound `rfc822_message_id`s chronologically and stores them as `references` + `inReplyTo` on the outbound snapshot; the dispatcher builds the Resend `headers` map (`Message-Id` always, `In-Reply-To` + `References` when the chain is non-empty). Inbound rows extract their own `rfc822_message_id` + `in_reply_to` + `references_json` via `extractInboundRfc822Headers` for header-first thread matching.

**Pre-send guardrails engine** (`evaluatePreSendGuardrails`). Six check classes split into **hard** (non-overridable: suppression, claim safety, thread active-send, scoped policy state, send ambiguity, pending suppression-class webhook) and **soft** (operator must acknowledge each code by name + supply ≥10-char reason). `policy_blocker` work item idempotent per `${draftId}:${code}` appears in the Inbox `manual_hold` tab. Cold vs warm partitioned: warm drafts skip `cooldown` / `retry_after` at non-contact/non-thread scope.

**Notifications and operator UX.** `telegramClient.ts` wraps Bot API; new job type `job.send_telegram_notification`; skip cleanly when env unset. `enqueueTelegramNotificationJob` hooked at four sites (dead-letter, `send_ambiguous` transition, `policy_blocker` insert, warm `draft_review_pending` insert) inside the source tx — atomic with the underlying state change. Inbound Telegram webhook: `/help`, `/queue`, `/snooze`, `/dismiss`, `/resolve`, `/approve <draftId> [version]` — operator allowlist via `TELEGRAM_OPERATOR_MAP`. Dashboard surfaces: `app/page.tsx` (Inbox with priority bands + action commands), `app/work-items/[id]/page.tsx` (raw webhook payload + Attach-to-thread), `app/drafts/page.tsx` + `app/drafts/[id]/page.tsx` (quality panel, version history, feedback timeline, revise flow), `app/organizations/[id]/page.tsx` (research-snapshot form + contact candidates approve/reject), `app/threads/[threadId]/page.tsx` (warm draft form).

**Internal RAG and learning memory.** `rag_documents` carries `{source_entity_type, source_entity_id, organization_id, corpus_label, quality_score, summary, indexed_version, metadata_json}` with unique partial index by source. `indexCorpusArtifact(tx, artifact)` upserts by source pair, replaces chunks, bumps `indexed_version`, enqueues `job.index_rag_document` (concurrency key `rag_document:<id>`). Auto-enqueue from mutation sites: `recomputeDraftScores` per-version pass calls `indexCorpusArtifact` whenever a version's `corpus_label` flips and the new label is positive/negative (neutral skipped — not retrievable); `recordDraftFeedback` indexes positive/negative feedback rows immediately. `retrieveRagContext(queryText, queryEmbedder, organizationId?, corpusLabels?, limit ≤ 100)` does cosine-similarity retrieval with org-scope and corpus-label-scope filtering. The indexing pipeline and the Vertex embedder behind `RagEmbedFn` are shipped; the retrieval side surfaced at draft-generation time (so positive examples bias new drafts and negative anti-patterns bias against them) and the prompt-assembly into ADK stages are the next deliverables — not in the tree.

Status: the full outreach loop runs end-to-end today — data layer, async job runtime, Resend inbound and RFC822-correct outbound, operator dashboard, drafting cycle (manual + AI cold + AI warm + AI revise + claim validation + research-more + quality scoring + corpus labels + versioned history), Telegram notifications and inbound operator commands, the pre-send guardrail engine, and the internal-RAG indexing pipeline with its Vertex embedder. The retrieval side that feeds positive/negative draft examples back into the prompt at generation time is the next development item.

### 5.3 ValidatorInfo (knowledge hub + 5 AI features)

Next.js + Prisma + `@ai-sdk/google-vertex 4.0.128`. Single Vertex provider in `src/app/services/ai/vertex-provider.ts`: `createVertex({project, location: 'global'})`, lazy-cached. Five AI features:

**(a) AI chat** — server action `askAgent(messages, context)` in `src/actions/ai-chat.ts`. Per-IP Redis rate limit (`CACHE_KEYS.ai.rateLimit`), `AiService.isAvailable = hasVertexConfig()` gate, message validation (`isValidMessage`, drop invalid with warn), context sanitization. System prompt built via `buildSystemPrompt(safeContext)` from `src/app/services/ai/ai-service.ts` (37+ declared page types in `PAGE_DESCRIPTIONS`, runtime injection of chain / validatorId / validatorAddress / proposalId). Forum nudge appended every third user message (5-variation array pointing to `forum.validatorinfo.com`). `generateText({ model: chatModel(), system, messages, tools: aiTools, stopWhen: stepCountIs(MAX_STEPS), abortSignal: 120s })` — Vercel AI SDK multi-step agentic loop. Eight tool modules composed into `aiTools` (`src/app/services/ai/tools/tools.ts`): `chainTools`, `validatorTools`, `governanceTools`, `marketTools`, `podcastTools`, `explainTools`, `valueTools`, `ai-data-helpers`. `formatLlmError` extracts `name`, `elapsedMs`, `message`, `statusCode`, `url`, `responseBody[:500]`, `cause.*` for single-glance operator triage. UI entry points: floating button + modal + provider (`src/app/[locale]/components/ai-chat/`), home inline (`ai-chat-inline.tsx`, `ai-chat-home-suggestions.tsx`), and contextual `ai-explain-button.tsx` emitting `AI_CHAT_OPEN_EVENT` with page-specific message.

**(b) AI proposal explanations** — server action `generateProposalSummary(chainId, proposalId, locale)` in `src/actions/ai-summary.ts`. Cache check first: `proposal.aiSummary[locale]` JSONB column — cache hit returns immediately, no LLM. Per-IP rate limit (`RATE_LIMIT = 5`, `RATE_WINDOW = 60`). Resolves proposal text via `ProposalService.getProposalById` preferring `description` (rejecting machine-`Payload`-prefixed) over `fullText`. Locale-aware system prompt: "concise summarizer for blockchain governance proposals … 2–3 sentence summary … focus on: what the proposal does, why it matters, what changes if it passes … simple plain language, no markdown headers or bullets, plain sentences ending with a period." `callWithRetry` truncates to `FALLBACK_LENGTH = 50_000` on failure. Sentence-end completion check via `/[.!?。！？]$/`; one retry on truncation, accept longer of the two. Fire-and-forget DB save via `ProposalService.saveAiSummary(chainId, proposalId, locale, text)` only when complete. 120s `AbortController` timeout.

**(c) Podcast episode summarization** — `server/tools/init-podcasts/podcast-processor.ts` runs in the indexer pipeline. Per episode after transcript parsing: `generateText({ model: getSummaryModel(), prompt: 'Write a 500–1000 word English summary of this Citizen Web3 podcast interview with guest <guest>. Focus on the guest's key opinions, positions, insights and values. Include notable direct quotes. Plain prose, no headers or bullet points. **Only include information directly stated in the transcript.** Transcript: ...' })`. The anti-fabrication constraint is the last sentence.

**(d) Host meta-generation (7-topic aggregate)** — `server/tools/init-podcasts/host-meta-generator.ts`. `HOST_TOPICS = [Technologies, Validating, Consensus, Blockchain networks, AI, Privacy, Decentralization]`. For each topic: filter host chunks across all episodes, call `generateText` with a topic-specific prompt that names the host's positions (e.g., for Technologies: "tech stack preferences, protocols he advocates for, dev tools, languages, Layer 1 vs Layer 2, modular vs monolithic, privacy technologies, open-source philosophy"). The resulting 7 topic summaries are embedded via `embedMany` and stored as a synthetic `__host_meta__` episode in `podcast_episodes` + `podcast_chunks`. A query like "what does the host think about liquid staking" hits the host-meta corpus through the same `search_rag` pathway that serves Aida.

**(e) "Explain this page" entry points** — `ai-explain-button.tsx` emits `AI_CHAT_OPEN_EVENT` with a page-specific message (default `tAi('Explain this page')`). Hooked into the floating button (`ai-chat-floating-button.tsx`), the navigation bar (`navigation-bar-item.tsx`), and the header action buttons (`header-action-buttons.tsx`). The chat modal opens pre-loaded with that question + the current `PageContext`.

The **RAG HTTP endpoint** (`GET /api/rag/search`, `src/app/api/rag/search/route.ts`) is the external face of the corpus: shared-secret `x-rag-api-token` auth via `authorizeRequest`; query params `q`, `limit`, `speaker` (`GUEST | HOST | ALL`), `validatorId` (positive integer scope); pipeline = `EmbeddingService.embedQuery(q)` → `podcastService.searchChunks(embedding, OVERFETCH_LIMIT, validatorId, speakerRole)` → `podcastService.formatSearchResults(rawResults, limit)`.

### 5.4 Logos onboarding

Next.js 16 + Drizzle + TypeScript. Vercel AI SDK (`@ai-sdk/google-vertex 4.0.128`, `@ai-sdk/react 3.0.179`) talks to Vertex directly. Model registry in `src/lib/model-config.ts`.

**Four-step retrieval** in `src/app/services/retrieval-service.ts` returns `RetrievalResult { query, rewritten, chunks, retrievalLatencyMs, stepTimings: { rewriteMs, embedMs, searchMs, rerankMs, rewriteCacheHit, embedCacheHit } }`:

1. **Rewrite** — `rewriteQuery(query, history, skipRewrite)`. With history: resolves pronouns and implicit references ("that", "it", "more about it") using the prior conversation. Without history: simpler prompt. `generateText(rewriteLanguageModel(), temperature: 0)`. Cached via `retrievalCacheService.getRewrite/setRewrite` only when no history (rewrite depends on context).
2. **Embed** — `embeddingService.embedQuery(rewritten)`. Cached. `mockEmbedding` when `RETRIEVAL_MOCK_EMBEDDINGS=1`.
3. **Hybrid search** — `chunkService.searchHybrid(vector, embeddingModel)`. HNSW dense (`vector_cosine_ops` on `logos_chunks.embedding`) + GIN tsvector lexical fused via RRF (Reciprocal Rank Fusion). Output `RerankCandidate[]` carrying `rrfScore`.
4. **LLM rerank** — `rerank-service.ts`. `generateText(rerankLanguageModel(), responseSchema: z.object({ rankings: z.array(z.object({ id: z.number().int(), score: z.number().min(0).max(10) })) }))`. Schema-invalid OR LLM-error → `fallback(candidates, limit)` returns monotone `rerankScore: 10 - index`.

**Chat route** (`src/app/api/chat/route.ts`, 333 lines): `isLocalRequest` early-guards with 403; Zod request schema `{id?, sessionId?, messages: 1-24}`; `sanitizeMessages` filters role + last 12 + `sanitizeUserText` on user parts; 4000-char query cap; 30 req/60s per `hashIp` rate limit. Lazy `loadServices()`. Streaming via Vercel AI SDK (`streamText`, `convertToModelMessages`, `createUIMessageStream`, `createUIMessageStreamResponse`). Citation metadata via `messageMetadata.sources = ChatSource[] { id, citationId, title, url, sourceType, snippet }` for UI citation chips. Weighted history via `buildWeightedHistory`. When chunks empty → `createMockResponse` streams `fallbackAnswer(query, chunks)` token-by-token via UIMessageStream with `model: 'mock-chat'` in the chat log. `maxDuration = 60s`.

**Chat log persistence** (`chat-log-service`): every exchange writes `{sessionId, ipHash, query, rewrittenQuery, retrievedIds, answer, sourcesJson, latencyMs, retrievalLatencyMs, generationLatencyMs, model, finishReason}`.

**Vector schema** (`logos_chunks`): `vector('embedding', { dimensions: LOGOS_EMBEDDING_DIMENSIONS = 768 })`, per-row `embedding_model varchar(64)`, HNSW `vector_cosine_ops` index, GIN tsvector index on `contentTsv`. Per-row `embedding_model` lets queries narrow to one space (`AND embedding_model = ?`) and avoids mixing incompatible vectors during reranking.

**Indexer pipeline** (`indexer/`): `chunker.ts` (paragraph + size + section-aware), `document-hash.ts` (content hash dedupe key), `embedder.ts` (Vertex via `@ai-sdk/google-vertex`), `upsert.ts` (writes into `logos_chunks` with unique index on `(sourceId, chunkIndex)`). Four source kinds in `indexer/sources/`: `github-docs.ts`, `raw-github-docs.ts`, `static-docs.ts` (`sourceType: 'static_seed'`), `web-docs.ts`. `indexer/jobs/source-job.ts` is the unified job runner.

---

## 6. Tech stack — canonical single-source table

### 6.1 LLM models (deployed)

| Surface | Role | Model | Effort | API path | Tools |
|---|---|---|---|---|---|
| Aida | router | `gemini-2.5-flash-lite` | — (structured output only) | `google.genai.generate_content` direct with `response_schema {respond, reason}` | — |
| Aida | reactive | `gemini-3.5-flash` | `low` | ADK `InMemoryRunner` | `query_validatorinfo`, `search_rag`, `web_research` (AgentTool sub-agent) |
| Aida | reply | `gemini-3.5-flash` | `high` | same | same |
| Aida | verification | `gemini-3.5-flash` | `high` | same | same |
| Aida | web_research (sub-agent) | `gemini-3.5-flash` | — | ADK Agent inside `AgentTool` | `google_search` (isolated) |
| BizDev | all 10 stages | per-stage env-resolved via `resolve_model()`; hard default `gemini-3.5-flash` | per env | ADK FastAPI `POST /runs/{stage}` NDJSON via `InMemoryRunner` | per `_STAGE_TOOLS` — research/contact/campaign → `[google_search]`; quality_gate / draft / draft_warm / revise / validate_claims / classify_reply → `[]` |
| ValidatorInfo | chat + summary | `gemini-3.5-flash` (unified) | — | `@ai-sdk/google-vertex` via `createVertex(...)` | 8 tool modules: chain / validator / governance / market / podcast / explain / value / ai-data-helpers |
| Logos | answer | `gemini-3-flash-preview` | — | `@ai-sdk/google-vertex` `streamText` | — |
| Logos | rewrite | `gemini-2.5-flash` | — | `generateText` | — |
| Logos | rerank | `gemini-2.5-flash` | — | `generateText` with Zod schema `z.object({rankings: [{id, score 0–10}]})` | — |

Notes: all three of Aida's tool-using roles run on `gemini-3.5-flash` today. Differentiation lives in the effort budget (`reactive: low`, `reply: high`, `verification: high`) and in the role's prompt + pipeline position, not in the model family.

### 6.2 Embeddings

| Surface | When | Model | Dim | Vertex API | SDK / Library |
|---|---|---|---|---|---|
| ValidatorInfo | deployed today | `gemini-embedding-001` | 768 | `embedContent` (global) | `@ai-sdk/google-vertex` |
| Logos | deployed | `gemini-embedding-001` (`LOGOS_EMBEDDING_DIMENSIONS = 768`) | 768 | `embedContent` (global) | `@ai-sdk/google-vertex` |
| BizDev | runtime, env-switched | `RAG_EMBED_PROVIDER ?? "stub"`; when `vertex`, model = `VERTEX_RAG_EMBED_MODEL ?? "gemini-embedding-2"` | 1536 (`VERTEX_RAG_EMBED_DIMENSIONS`, default 1536) | `embed_content` global for `gemini-embedding-2`; `predict` regional for `gemini-embedding-001` (rollback path) | `@google-cloud/aiplatform v1` `PredictionServiceClient` direct |
| Aida | n/a | (none — delegates to ValidatorInfo `search_rag` over HTTP) | — | — | — |

Notes on BizDev embedder: `createVertexRagEmbedder` defaults `taskType: "RETRIEVAL_DOCUMENT"` for the indexed corpus; `createVertexRagQueryEmbedder` pins `taskType: "RETRIEVAL_QUERY"` (asymmetric per Vertex docs). Batched at 25 per `predict` call. `embed_content` is one-at-a-time per Vertex API shape. `NonRetryableJobError` on gRPC 3 / 7 / 9 / 16 or HTTP 4xx non-429 → dead-letter. `gemini-embedding-2` requires `location: global`.

### 6.3 Vector stores

| Surface | Table | Schema | Indexes | Notes |
|---|---|---|---|---|
| ValidatorInfo | `podcast_chunks` | `embedding vector(768)` | HNSW `vector_cosine_ops` on `embedding` | Single column today; design plans add `embedding_bge vector(1024)` + parallel HNSW |
| Logos | `logos_chunks` | `embedding vector(768)`, `embedding_model varchar(64)` per row, `contentTsv` tsvector | HNSW on `embedding`, GIN on `contentTsv` (hybrid dense + lexical fused via RRF) | Per-row model tracking lets queries narrow to one embedding space |
| BizDev | `rag_embeddings` | `embedding vector(1536)`, `model varchar` per row | cosine retrieval via raw SQL with `vectorLiteral` cast | `retrieveRagContext(queryText, queryEmbedder, organizationId?, corpusLabels?, limit≤100)` — org-scoped + corpus-label scoped (positive / negative / neutral) |

### 6.4 Runtimes and dependencies

| Surface | Language / framework | Key deps |
|---|---|---|
| Aida | Python 3.13, ADK 2.1.0, google-genai 1.75.0, Telethon, aiogram, asyncio, aiosqlite, pydantic | `google-adk`, `google-genai`, `google-auth`, `aiohttp` |
| BizDev | Python 3 (agent) + TS (worker/dashboard) | Python: `google-adk`, `google-genai`, `fastapi`, `uvicorn`, `pydantic`. TS: `@google-cloud/aiplatform v1`, `drizzle-orm`, `drizzle-kit`, `resend`, `node-telegram-bot-api`, `zod`, `next` |
| ValidatorInfo | TS / Next.js | `@ai-sdk/google` 3.0.30, `@ai-sdk/google-vertex` 4.0.128, `ai` (Vercel AI SDK), `prisma` |
| Logos | TS / Next.js 16.2.6 | `@ai-sdk/google-vertex` 4.0.128, `@ai-sdk/react` 3.0.179, `ai`, `drizzle-orm` 0.45.2, `drizzle-kit` 0.31.10, `zod` |

---

## 7. Production runtime properties

**Single GCP project.** All four surfaces resolve `GOOGLE_CLOUD_PROJECT` from environment; the project is the same. All four use `vertexLocation: 'global'` (Gemini-3 family — `gemini-3-flash-preview`, `gemini-3.5-flash` — is served only from `global` on this project; regional locations return 404 for them).

**ADC only.** Application Default Credentials at runtime: `GOOGLE_APPLICATION_CREDENTIALS` → service-account JSON, or metadata-server identity. Minimum IAM `roles/aiplatform.user`. SA file mounted read-only in Docker. Aida and BizDev both refuse to start if `GOOGLE_API_KEY` is set (anti-Developer-API safety). `GOOGLE_GENAI_USE_VERTEXAI=TRUE` set explicitly in Aida and BizDev. ValidatorInfo and Logos use the `@ai-sdk/google-vertex` `createVertex` factory with the same ADC.

**Observability.** Aida: per-call audit rows in SQLite with `audit_id`, `status` (`skipped_*` / `phase1` / `phase2` / `sent` / `error`), per-phase `tool_calls`, `last_error_class` from typed-error vocabulary, alerts to the approval channel (CRITICAL on `auth` / `config`, WARNING on `rate_limit` / `degraded_mode_entered`). BizDev: `agent_runs` + `agent_run_events` + `agent_run_artifacts` with NDJSON event stream and preserved Vertex citation metadata; `job_runs` attempt history; `event_log` indexed by `entity` + `correlation_id`; worker heartbeats; `/health` exposes stage list + per-stage tool allowlist. Logos: per-chat row in `chat-log-service` with retrieval lineage (`retrievedIds`), rewritten query, sources, three-way latency split, model, finishReason. ValidatorInfo: structured loggers (`logger('api:rag-search')`, `logger('ai-chat')`, `logger('ai-summary')`); `formatLlmError` extracts structured fields for single-glance triage.

**Operator-in-the-loop where high-stakes.** Aida: `mode: "approval"` config canary (humans review every draft pre-send). BizDev: every send is operator-gated via `approveDraftForSendCommand` after the pre-send guardrail engine clears (or operator manually overrides each soft code by name + ≥10-char reason). The dashboard surfaces priority-band Inbox + work-item detail + drafts review + organization page (contact candidate approve/reject) + thread page (warm draft form). ValidatorInfo and Logos chats are read-only by design; full chat logs persisted for operator inspection after the fact.

**What runs today.** Aida is live on Vertex with the three-Gate pipeline and the proactive scanner. BizDev runs the full outreach loop end-to-end: research, contact discovery, draft (cold + warm), AI revise, claim validation, send via Resend with RFC822-correct threading, 10-class reply classification, operator dashboard, Telegram operator surface, pre-send guardrail engine, internal-RAG indexing pipeline with the Vertex embedder. Logos serves chat in production with local-only access, per-IP rate limiting, and full chat-log lineage. ValidatorInfo's product-side AI features (page-context chat, proposal summaries, podcast summaries, host-meta corpus) and its hub-side endpoints (`/api/rag/search` and the read-only on-chain Postgres role) all run on Vertex today.
