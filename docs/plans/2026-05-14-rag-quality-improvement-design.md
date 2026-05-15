# RAG Quality Improvement — Design

Date: 2026-05-14
Branch: `logos-chatbot`

## Problem

Current RAG corpus has quality issues observed in production:

1. GitHub org sources disabled by default → no real LIP/spec coverage
2. Only `logos-co/logos-docs` repo indexed; `logos-co/logos-lips` not pulled (0 actual LIPs)
3. HTML pages keep navigation boilerplate (`Skip to content`, breadcrumbs, link-only lines) — pollutes chunks 89, 90 etc.
4. `webMaxPages = 4` too low; misses follow-up pages
5. `githubMaxFilesPerRepo = 20` too low for repos with > 20 markdown files
6. Naive word-split chunker (`MAX_WORDS=450`, `OVERLAP_WORDS=80`) — 56% of chunks hit upper bound, lose semantic boundaries
7. Waku content dominates (~75%); other sources underrepresented → corpus imbalance

## Goals

- Reach ≥ 70% section-path coverage (`section_path IS NOT NULL`)
- Reduce chunks at upper word-cap from 56% to < 20%
- Eliminate nav boilerplate from chunks
- Balance corpus: github > 60%, web ~25%, static < 15%
- Full LIP coverage from `logos-co/logos-lips` repo

## Non-goals

- No tiktoken / model-aware tokenization (overkill for current size)
- No incremental migration / dual-write (full wipe is acceptable)
- No backup / rollback (user confirmed)

## Design

### 1. Heading-aware markdown chunker

Replace `indexer/pipeline/chunker.ts`. Reference pattern: `validatorinfo/server/tools/init-podcasts/cw3-doc-processor.ts`.

Algorithm:

1. Split content by `^#{1,3}\s+.+$` regex — produces sections with heading + body
2. For each section:
   - Strip link-only lines (`wordCount(textWithoutLinks) < 30` → drop)
   - If `wordCount < MIN_WORDS` (target ~ 80): push to `mergeBuffer`, attach to next section
   - If `wordCount > MAX_WORDS` (target ~ 600): apply `splitWithOverlap` (paragraph-aware)
   - Else: emit as one chunk
3. Section path: track heading stack `[h1, h2, h3]` → join with ` > `
4. Context prefix: `${sectionPath}\n\n` prepended for embedding (not stored in `content`)

Config:
- `MIN_CHUNK_WORDS = 80`
- `MAX_CHUNK_WORDS = 600`
- `OVERLAP_WORDS = 100` (used only when section overflows MAX)

Output: `{ content, sectionPath, contextPrefix, tokenCount }[]` — matches existing schema.

### 2. HTML cleaner enhancement

Modify `indexer/fetchers/html.ts`. After Turndown markdown produced, apply `stripNavBoilerplate(markdown)`:

- Drop lines matching: `^Skip to (main )?content`, `^Table of contents`, `^On this page`, `^Previous|Next page`
- Drop lines where `textWithoutMarkdownLinks.trim().length < 8` AND original line has ≥ 2 markdown links (breadcrumbs)
- Drop consecutive blank lines collapse to single

Applied before chunker receives markdown.

### 3. Per-source chunk cap

`indexer/pipeline/upsert.ts` — enforce `MAX_CHUNKS_PER_SOURCE = 30`. If source produces > 30 chunks after chunker, take top 30 by token_count desc. Prevents Waku doc dumps dominating corpus.

### 4. Config bumps

`indexer/config.ts`:

```ts
webMaxPages: envInt('INDEXER_WEB_MAX_PAGES_PER_SOURCE', 30),       // 4 → 30
githubMaxFilesPerRepo: envInt('INDEXER_GITHUB_MAX_FILES_PER_REPO', 60), // 20 → 60
enableGithubSources: envFlag('INDEXER_ENABLE_GITHUB_SOURCES', true), // false → true
```

### 5. LIP source registration

`indexer/sources/github-docs.ts` — add `logos-co/logos-lips` to `pathPriority` map with priority 20 (highest). Walker already supports lips/ filter pattern.

### 6. Wipe + reindex

`scripts/wipe-rag.ts`:

```ts
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
await sql`TRUNCATE TABLE logos_chunks, logos_sources RESTART IDENTITY CASCADE`;
console.log('RAG tables wiped');
await sql.end();
```

`package.json`:
```json
"rag:wipe": "TSX_DISABLE_IPC=1 DATABASE_URL=${DATABASE_URL:-postgresql://logos:logos@localhost:55433/logos_chatbot} tsx scripts/wipe-rag.ts"
```

Reindex command (manual after wipe):
```bash
docker compose -f docker-compose.dev.yml run --rm \
  -e INDEXER_RUN_ONCE=1 \
  -e INDEXER_ENABLE_STATIC_SOURCE=1 \
  -e INDEXER_ENABLE_WEB_SOURCES=1 \
  -e INDEXER_ENABLE_GITHUB_SOURCES=1 \
  -e INDEXER_MOCK_EMBEDDINGS=0 \
  indexer
```

### 7. Verification

`scripts/rag-verify.ts` — runs 4 SQL checks, prints pass/fail:

1. `chunk distribution` by source_type: assert github > 60%, web 15-35%, static < 15%
2. `section_path coverage`: assert ≥ 70%
3. `chunk size`: assert `COUNT(*) FILTER (token_count >= 600) / COUNT(*) < 0.2`
4. `nav boilerplate`: assert `COUNT(*) WHERE content ILIKE '%skip to content%' OR ILIKE '%table of contents%' = 0`

`package.json`:
```json
"rag:verify": "TSX_DISABLE_IPC=1 DATABASE_URL=${DATABASE_URL:-postgresql://logos:logos@localhost:55433/logos_chatbot} tsx scripts/rag-verify.ts"
```

## File ownership matrix

| File | Owner |
|------|-------|
| `indexer/pipeline/chunker.ts` | chunker-dev |
| `indexer/fetchers/html.ts` | html-cleaner-dev |
| `indexer/pipeline/upsert.ts` | cap-dev (small change) |
| `indexer/config.ts` | config-dev (small change) |
| `indexer/sources/github-docs.ts` | lips-source-dev (small change) |
| `scripts/wipe-rag.ts` (new) | scripts-dev |
| `scripts/rag-verify.ts` (new) | scripts-dev |
| `package.json` | lead (merge conflicts safer here) |

Independent tasks: chunker, html-cleaner, scripts. Small config changes can be bundled into one task (config-bump).

## Execution order

1. Parallel: chunker, html-cleaner, scripts (wipe + verify), config-bump
2. After all merged: `yarn lint && yarn build`
3. Manual: `yarn rag:wipe` → docker reindex → `yarn rag:verify`
