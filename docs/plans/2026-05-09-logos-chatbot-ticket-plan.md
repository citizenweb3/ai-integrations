# Logos Chatbot — Ticketed Implementation Plan

Date: 2026-05-09
Status: Proposed execution plan before implementation
Inputs:
- `docs/plans/2026-05-08-logos-chatbot-design.md`
- `docs/plans/2026-05-08-logos-chatbot-handoff.md`

This document turns the design and handoff into reviewable tickets. Each ticket is intended to be completed, verified, and reviewed before the next ticket starts.

## Key Corrections Before Building

1. The current `logos-chatbot` checkout has no tracked files and contains stale untracked files from the previous Python Telegram Growth Agent. Clean the root fully and build the Next.js implementation as a fresh product scaffold.
2. Current package versions checked on 2026-05-09:
   - `next`: `16.2.6`
   - `react`: `19.2.6`
   - `ai`: `6.0.177`
   - `@ai-sdk/google`: `3.0.71`
   - `drizzle-orm`: `0.45.2`
   - `drizzle-kit`: `0.31.10`
   - `tailwindcss`: `4.3.0`
   - `typescript`: `6.0.3`
3. Use AI SDK v6 APIs, not v5 assumptions from the handoff. The route-handler shape is still `streamText(...)` plus `toUIMessageStreamResponse()`, but client usage should follow current `useChat` APIs.
4. Use the `validatorinfo` embedding pattern: request `outputDimensionality: 768` from the Google embedding provider, validate the returned vector length, and fail explicitly if the provider returns anything else. Do not silently truncate embeddings.
5. Keep the design doc's trigger-backed `content_tsv` implementation for MVP. Generated `tsvector` columns can be revisited later, but the first migration should use the known working trigger approach.
6. Keep `chat_logs` in the database for RAG quality review and debugging. Do not build an admin UI for MVP; runtime and indexer operations should be inspected through Docker logs.
7. Model names should be env-configurable. Defaults can target Gemini 3 / Gemini 2.5 Flash, but production should not require code edits if Google model IDs change.

## Review Rules

- Stop after each ticket and wait for review.
- Do not commit unless explicitly asked.
- Before editing existing symbols, run GitNexus impact analysis. Most early work adds new files, but existing-symbol edits still require impact checks.
- Before any requested commit, run `gitnexus_detect_changes()`.
- Keep DB access restricted to `src/app/services/*` and `indexer/**`.

## Ticket 0 — Workspace Hygiene and Final Decisions

Goal: make the branch safe to scaffold into.

Scope:
- Remove stale untracked Python-agent files from the product root.
- Preserve the planning docs under `docs/plans/`.
- Decide package manager: default to `yarn`, matching the handoff and `validatorinfo`.
- Use Docker Compose from the first implementation ticket. Local `yarn dev` may remain useful for debugging, but review acceptance is based on Docker boot.
- Finalize model env var names:
  - `GOOGLE_GENERATIVE_AI_API_KEY`
  - `ANSWER_MODEL`
  - `REWRITE_MODEL`
  - `RERANK_MODEL`
  - `EMBEDDING_MODEL`

Acceptance:
- The product root is clean and ready for a fresh Next.js scaffold.
- Planning docs remain available after cleanup.

Review focus:
- Workspace cleanup choice.
- Version and package manager choice.

## Ticket 1 — Next.js Skeleton and Containers

Goal: boot a fresh app with Postgres and Redis.

Scope:
- Create `package.json`, `tsconfig.json`, `next.config.ts`, ESLint config, Tailwind setup.
- Add `src/app/layout.tsx`, `src/app/page.tsx`, and minimal global styles.
- Add `docker/Dockerfile.app`, `docker/Dockerfile.indexer`, `docker/postgres-init.sh`.
- Add `docker-compose.dev.yml` with `postgres`, `redis`, `app`, and placeholder `indexer`.
- Add `.env.example`.
- Add root `AGENTS.md` for the new app structure.

Acceptance:
- `yarn install` succeeds.
- `yarn build` or at least `yarn lint && yarn typecheck` succeeds.
- `docker compose -f docker-compose.dev.yml up --build` starts Postgres, Redis, the Next.js app, and the placeholder indexer service.
- `/` renders a simple Logos Chatbot placeholder.

Review focus:
- Clean scaffold.
- Dependency versions.
- Container naming, ports, and env shape.

## Ticket 2 — Database Schema and Service Boundary

Goal: create the durable data model and enforce access rules.

Scope:
- Add `drizzle.config.ts`, `src/db/schema.ts`, `src/db/index.ts`.
- Create tables:
  - `logos_sources`
  - `logos_chunks`
  - `chat_logs`
- Add pgvector HNSW and GIN indexes.
- Add trigger-backed `content_tsv` exactly as the design doc specifies.
- Add service stubs:
  - `source-service.ts`
  - `chunk-service.ts`
  - `chat-log-service.ts`
  - `rate-limit-service.ts`
- Add ESLint `no-restricted-imports` so only services and indexer import `@/db`.

Acceptance:
- Fresh migration applies to an empty Postgres container.
- Schema can be introspected with expected vector and full-text indexes.
- A grep/check proves no app route/component imports `@/db`.

Review focus:
- Schema correctness.
- Migration safety.
- `chat_logs` fields for useful RAG debugging without an admin UI.

## Ticket 3 — Embeddings and Retrieval Smoke Path

Goal: prove hybrid retrieval on a tiny local corpus before building the full indexer.

Scope:
- Implement `embedding-service.ts`.
- Implement `chunk-service.hybridSearch()` with vector + BM25 + RRF.
- Implement `rerank-service.ts` with JSON/zod validation and RRF fallback.
- Implement `retrieval-service.ts` orchestration:
  - query rewrite
  - query embedding
  - hybrid search
  - rerank
  - top-k context result
- Add a script under `scripts/` that inserts 3-5 seed Logos docs and queries them.

Acceptance:
- Smoke script inserts sources/chunks.
- Smoke query returns relevant ranked chunks with source metadata.
- Retrieval works when reranker fails by falling back to RRF.

Review focus:
- SQL safety and vector formatting.
- Reranker prompt/output contract.
- Latency logging boundaries.

## Ticket 4 — Indexer Core

Goal: populate the database from real sources, incrementally.

Scope:
- Add `indexer/` entrypoint, config, worker scheduling, and shared types.
- Implement source adapters for the first three source types:
  - GitHub markdown/README from allowlisted orgs/repos
  - HTML crawl for `logos.co` / `build.logos.co`
  - docs crawl for `docs.waku.org`
- Implement chunkers:
  - markdown header-aware chunker
  - HTML readability/turndown chunker
- Implement pipeline:
  - content hash / remote revision diff
  - contextual prefix generation
  - batch embeddings
  - transactional upsert
- Add indexer run logging.

Acceptance:
- One manual indexer run populates at least 3 source types.
- Re-running is idempotent and skips unchanged sources.
- Failed source fetches are recorded without killing the whole run.

Review focus:
- Incremental update logic.
- Crawl bounds and source allowlist.
- Cost and rate-limit handling.

## Ticket 5 — Chat API Route

Goal: stream cited RAG answers through the AI SDK route.

Scope:
- Add `src/app/api/chat/route.ts`.
- Validate request shape with zod.
- Enforce Redis IP/session rate limits.
- Build context-only system prompt from retrieved chunks.
- Stream answer with `streamText`.
- Attach sources metadata for the UI.
- Record chat logs on finish, including latencies and token usage when available.
- Add prompt-injection sanitation for user query and indexed context.

Acceptance:
- API streams a real answer from seeded/indexed chunks.
- Off-topic or insufficient-context questions produce the configured fallback.
- Chat log row is written.
- Rate limiting returns 429.

Review focus:
- AI SDK v6 correctness.
- Prompt and citation discipline.
- Failure behavior when Redis, DB, or Gemini is unavailable.

## Ticket 6 — Chat UI

Goal: deliver the user-facing onboarding chat.

Scope:
- Build components:
  - `ChatThread`
  - `MessageBubble`
  - `Composer`
  - `SourceChip` / sources block
  - `Suggestions`
  - `FeedbackButtons`
  - markdown/code rendering
- Use `@ai-sdk/react` `useChat`.
- Store local chat history in `localStorage`.
- Render inline citation markers and source blocks.
- Keep UI English-only.

Acceptance:
- User can ask a question, see streaming output, and inspect sources.
- Refresh keeps local chat history.
- Empty state suggestions submit real prompts.
- Layout works on mobile and desktop.

Review focus:
- UX quality.
- Citation/source readability.
- No marketing landing page taking over the first screen.

## Ticket 7 — Feedback and Operational Logging

Goal: capture useful product feedback and runtime diagnostics without building an admin UI.

Scope:
- Add server action for feedback.
- Store feedback on `chat_logs`.
- Ensure app and indexer logs are structured enough for `docker logs`.
- Add a protected indexer reindex endpoint only if needed for operations; otherwise rely on cron and manual container commands.

Acceptance:
- Feedback updates the matching chat log.
- Chat route records query, rewritten query, retrieved chunk IDs, answer, sources, latencies, model, and feedback.
- Indexer logs show source id/type, action, chunk count, skip reason, duration, and errors.

Review focus:
- Whether logs are enough to operate the service from Docker.
- No accidental exposure of prompts, secrets, or raw IPs.

## Ticket 8 — Full Source Coverage and Hardening

Goal: complete source inventory and launch readiness.

Scope:
- Add remaining adapters:
  - RSS/blogs
  - Discourse forums
  - YouTube transcripts
  - code chunker for selected SDK/example files
  - LIPs/specs specialized metadata
- Add robots.txt respect and crawl budgets.
- Add daily cost cap and Redis counters.
- Add retention cleanup for chat logs.
- Add README, `docs/architecture.md`, `docs/adding-source.md`, `docs/ops-runbook.md`.
- Add 20-question eval set and smoke runner.

Acceptance:
- All configured source types can index successfully or fail with visible status.
- 20-question eval reaches the agreed quality target.
- Fresh setup docs are enough to run locally.
- `yarn build` passes.

Review focus:
- Answer quality and citation quality.
- Cost controls.
- Launch checklist.

## Open Questions

1. Which exact public domain should be used for `PUBLIC_URL` examples and CORS defaults?
