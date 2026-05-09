# Logos Chatbot — Implementation Handoff

> **For implementer (Codex):** This is a high-level handoff, not a rigid task list. Full design context lives in `docs/plans/2026-05-08-logos-chatbot-design.md` — read it first. Use it as the source of truth for architecture, schema, and decisions. This document tells you the story: what we built, why, in what order, and what done looks like. You have latitude on tactics — keep faith with the design, exercise judgment on details.

**Goal:** Build a self-hosted onboarding chatbot for the Logos network that answers questions from official sites, docs, tutorials, GitHub repos, forums, and blogs using a hybrid RAG pipeline (vector + BM25 + RRF + reranking) with Gemini 3 as the answer model.

**Architecture:** Three logical services in one Next.js 16 monorepo: (1) Frontend chat UI, (2) RAG retrieval API, (3) Indexer (cron + on-demand). Postgres + pgvector for storage, Drizzle ORM for db access, AI SDK v5 for streaming, Google Gemini for embeddings/reranking/generation.

**Tech Stack:** Next.js 16 (App Router, turbopack, cacheComponents), AI SDK v5, Drizzle ORM, Postgres 16 + pgvector, Redis (rate limiting + cache), Gemini 3 Pro Preview (answers), Gemini 2.5 Flash (rerank + query rewrite), gemini-embedding-001 (768d). Self-hosted via Docker Compose.

---

## Context You Need Before Starting

1. **Read `docs/plans/2026-05-08-logos-chatbot-design.md` end to end.** It contains:
   - Full Drizzle schema (logos_sources, logos_chunks, chat_logs)
   - Source inventory (logos.co, docs.waku.org, github.com/logos-co [104 repos], github.com/logos-blockchain [16 repos], LIPs, blogs, forums, etc.)
   - Hybrid search SQL with RRF (k=60)
   - Service layer rule: only `src/app/services/*` and `indexer/**` touch the db
   - System prompt builder
   - Docker Compose layout
   - Security matrix (10 attack vectors)
   - 4-week milestone breakdown

2. **Reference repo for patterns:** `~/project/dev/validatorinfo` — same author, same conventions. Mirror its service layer style:
   ```ts
   const xxxService = { method1, method2 };
   export default xxxService;
   ```
   Mirror its indexer worker thread pattern (`server/indexer.ts`, `server/jobs/`). Mirror its RAG ingest pattern (`server/tools/init-podcasts/`).

3. **Branch context:** You are on orphan branch `logos-chatbot` in repo `ai-integrations`. Working tree may contain stale unstaged files from previous branch — ignore them; only design doc is intentional. Start scaffolding fresh.

---

## Decisions Already Made (don't relitigate)

| Topic | Decision | Rationale |
|------|----------|-----------|
| ORM | Drizzle, not Prisma | Native pgvector + tsvector support; Prisma forces `Unsupported` and breaks HNSW on migrate |
| Streaming | Route handler `/api/chat` (AI SDK v5) | `useChat` requires HTTP UI Message Stream protocol |
| Mutations | Server actions | Per Vercel best practices for non-streaming writes |
| DB access | Service layer only | Routes/actions/components must NOT import `db` directly |
| Embeddings | gemini-embedding-001 truncated to 768d | Free, MTEB 68.3%, fits HNSW cleanly |
| Reranker | Gemini 2.5 Flash | Cheap, fast, biggest single quality lever per session-39 patterns |
| Generator | Gemini 3 Pro Preview | Quality > latency for onboarding answers |
| Chunking | Semantic + contextual prefix (Anthropic style) | -49-67% retrieval errors |
| Retrieval | Hybrid: vector top-40 + BM25 top-40 → RRF (k=60) → rerank top-8 | Hybrid > pure vector for technical terminology |
| Search policy | Always-search (no router) | MVP simplicity; revisit after telemetry |
| Indexing | Cron incremental + manual reindex hook | Sources change at different rates |
| UI | Single chat page, English-only MVP | Ship narrow, expand later |
| Deploy | Self-hosted Docker Compose | User preference |
| Locales | en only for MVP | No next-intl yet |

---

## Implementation Story (recommended order)

You can reorder if you have reason. Each phase is a coherent commit point.

### Phase 1 — Skeleton & Plumbing
- Next.js 16 app scaffold (App Router, TypeScript, Tailwind 4, ESLint).
- `package.json` with: `next@16`, `ai@5`, `@ai-sdk/google`, `drizzle-orm`, `drizzle-kit`, `postgres` (or `pg`), `ioredis`, `zod`.
- `drizzle.config.ts`, `src/db/schema.ts` (copy from design §4), `src/db/index.ts` (singleton client).
- `docker-compose.dev.yml` (postgres+pgvector, redis, app, indexer) — copy from design §10.
- `.env.example` from design §13.
- Root layout, single `/` chat page placeholder.
- First migration: `drizzle-kit generate` then apply. Manually add HNSW + GIN indexes via post-migration SQL (Drizzle won't track them well — design §4 has the exact SQL).

**Done when:** `docker compose up` boots, db migrated, page renders "Logos Chatbot" string.

### Phase 2 — Service Layer
- `src/app/services/sources-service.ts` — CRUD for `logos_sources`.
- `src/app/services/chunks-service.ts` — insert chunks, hybrid search SQL (design §7 has the CTE).
- `src/app/services/embeddings-service.ts` — wrapper over `@ai-sdk/google` `embed`/`embedMany`, 768d truncation.
- `src/app/services/rerank-service.ts` — Gemini 2.5 Flash reranker (prompt: rate relevance 0-10).
- `src/app/services/chat-log-service.ts` — record turns, sources, latencies.
- `src/app/services/rag-service.ts` — orchestrates: query rewrite → hybrid search → rerank → return top-8 chunks + metadata.

**Rule:** these are the only files that import `db`. Routes and actions go through them.

**Done when:** unit-style smoke test (script in `scripts/`) embeds a doc, inserts, queries hybrid search, gets ranked results.

### Phase 3 — Indexer
- `indexer/` folder, parallel to `src/`. Own entrypoint, own Docker service.
- Source adapters in `indexer/sources/`:
  - `web-readability.ts` — Mozilla Readability + turndown for HTML pages (logos.co, build.logos.co, blogs).
  - `docs-site.ts` — sitemap-driven crawl for docs.waku.org, status.app docs, etc.
  - `github-repo.ts` — GitHub Trees API for file list + Contents API for `.md`/`.mdx`/`README` only. Respect `GITHUB_API_TOKEN`. Two orgs: `logos-co` (104 repos) and `logos-blockchain` (16 repos).
  - `discourse.ts` — forum JSON API.
  - `lips.ts` — LIPs repo (Logos Improvement Proposals).
- `indexer/pipeline/`:
  - `chunker.ts` — semantic chunks 256-512 tokens, 100-word overlap.
  - `contextual-prefix.ts` — Gemini 2.5 Flash generates 50-100 token prefix per chunk (prompt in design §6).
  - `embedder.ts` — batch embed `content_for_embed` (= prefix + content).
  - `upsert.ts` — diff by content hash; insert/update/delete chunks per source.
- `indexer/jobs/`:
  - Per-source cron jobs (table in design §6 — daily for docs, hourly for forums, etc.).
  - One worker thread per job (validatorinfo pattern).
- `indexer/index.ts` — entrypoint, registers crons, exposes `POST /reindex?source=<id>` admin trigger (auth via `RAG_API_TOKEN`).

**Done when:** running indexer once populates `logos_sources` and `logos_chunks` from at least 3 source types (web, github, docs). Running it again is idempotent.

### Phase 4 — Chat Route & UI
- `src/app/api/chat/route.ts` — POST handler. Validates input (Zod), rate-limits (Redis bucket per IP), runs query rewrite → `ragService.retrieve` → `streamText({ model: gemini-3-pro-preview, system: buildSystemPrompt(chunks), messages: convertToModelMessages(messages), onFinish: chatLogService.record(...) }).toUIMessageStreamResponse({ messageMetadata: () => ({ sources }) })`. Code shape in design §8.
- `src/app/services/prompt-service.ts` — `buildSystemPrompt(chunks)` (design §8 has the template). Cite sources by id, refuse off-topic, English-only.
- `src/app/page.tsx` — chat UI using `useChat` from `@ai-sdk/react`. Streams tokens. Renders source chips below assistant messages from `messageMetadata.sources`.
- Components: `<ChatThread/>`, `<MessageBubble/>`, `<SourceChip/>`, `<Composer/>`.

**Done when:** ask "How do I run a Waku node?" in browser, get streaming answer with citations linking back to docs.waku.org.

### Phase 5 — Server Actions, Admin, Observability
- `src/actions/reindex.ts` — server action to trigger source reindex. Calls indexer admin endpoint with `RAG_API_TOKEN`. Used by admin page.
- `src/app/admin/page.tsx` — minimal: list sources with last-indexed time + chunk count, button to reindex, last 50 chat logs with latencies and source citations. Auth: simple token in env (`ADMIN_TOKEN`) — no SSO for MVP.
- Logging: chat_logs row per turn with `query`, `rewritten_query`, `retrieved_chunk_ids`, `final_answer`, `latency_ms_retrieval`, `latency_ms_generation`, `total_tokens`.

**Done when:** admin page shows real data; clicking reindex re-runs that source's pipeline.

### Phase 6 — Hardening
- Security matrix (design §11): prompt injection guards, rate limits, output filtering for PII, `robots.txt` respect on crawl, GitHub token scoping, source allowlist.
- Backfill all source types in inventory (design §5).
- Run end-to-end smoke: 20 representative onboarding questions, eyeball answers + citations.
- Pre-launch checklist (design §15).

---

## What "Done" Looks Like

- `docker compose -f docker-compose.dev.yml up -d --build` boots all services clean on a fresh machine.
- Indexer populates db from real Logos sources within first run (~30-60min initial backfill).
- `/` page accepts a question, streams Gemini 3 answer with cited sources, sub-2s TTFB on warm cache.
- `/admin` page shows sources, chat logs, reindex controls.
- Every db read/write goes through `src/app/services/*` or `indexer/**` — grep for `import.*from.*['"]@/db` outside those paths returns nothing.
- 20-question smoke set: ≥80% answers cite the right source; no hallucinated URLs.
- README.md documents setup, env vars, how to add a new source.

## Things to Watch Out For

- **HNSW + Drizzle:** Drizzle migrations don't track `using('hnsw', ...)` reliably. After every `drizzle-kit generate`, inspect SQL and re-add HNSW/GIN if dropped. Same trap as validatorinfo's Prisma + vector pain — design §4 documents the post-migration SQL to keep on hand.
- **Embedding cost:** initial backfill of all sources is the bulk of cost. Use `embedMany` batches of 100. gemini-embedding-001 is free tier but rate-limited — back off on 429.
- **GitHub rate limits:** authenticated = 5000 req/hr. Two orgs × ~120 repos × file lists × content fetches → easily hits limit. Use conditional requests (ETag) and per-repo last-indexed cursor.
- **Contextual prefix LLM cost:** 1 LLM call per chunk × thousands of chunks. Batch where possible; cache by content hash; don't regenerate if chunk content unchanged.
- **Streaming + service layer:** `streamText` is fine in route handlers; do NOT wrap it in a server action (server actions buffer responses, breaks streaming).
- **`'use cache'` and `cacheComponents`:** Next.js 16 caching is opt-in. Mark stable read paths (source list, chunk count) with `'use cache'`; never cache user-specific or LLM-generated content.
- **Vector dim 768 truncation:** gemini-embedding-001 returns 3072 by default. Truncate to first 768 dims AND L2-normalize before insert (design §6 has helper).
- **Locale:** English-only for MVP. Don't pull in next-intl. Don't add language switcher.
- **No commits during dev:** repo owner reviews working tree manually. Don't `git commit` unless asked.

## Reference Patterns to Mirror from validatorinfo

| Need | Read this in validatorinfo |
|------|---------------------------|
| Service object pattern | `src/app/services/chain-service.ts` |
| RAG ingest pipeline | `server/tools/init-podcasts/` (esp. `cw3-doc-processor.ts`, `shared.ts`) |
| Vector search SQL | `src/app/services/podcast-service.ts` |
| Indexer worker threads | `server/indexer.ts`, `server/jobs/` |
| AI chat orchestration | `src/app/services/ai/`, `src/actions/ai-chat.ts` |
| AGENTS.md style for module docs | any `AGENTS.md` in validatorinfo |

Write `AGENTS.md` files for `src/app/services/`, `indexer/`, and root as you go — future agents need them.

## Out of Scope (don't build)

- Authentication beyond admin token
- Multi-language UI (en only)
- Multi-tenancy
- Conversation memory across sessions (each chat is fresh)
- Tool-calling / agentic flows (just RAG)
- Voice / image input
- Mobile app
- Public deployment infra (CI/CD, k8s) — self-hosted Docker only

## When Stuck

1. Re-read the design doc section for that phase.
2. Look at validatorinfo for the analogous pattern.
3. Check context7 MCP for Next.js 16 / AI SDK v5 / Drizzle current docs — APIs evolved fast in 2026.
4. Ask the repo owner — do not invent architectural decisions.

---

**End of handoff. Design doc is source of truth for specifics; this doc is the story.**
