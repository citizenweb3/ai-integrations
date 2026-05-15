# Logos Chatbot

A self-hosted RAG (Retrieval-Augmented Generation) chatbot for the [Logos](https://logos.co) ecosystem. It answers questions about Logos, Waku, Nomos and related projects by continuously indexing documentation from official websites, GitHub repositories, and curated markdown files, then retrieving the most relevant chunks at query time.

---

## Architecture

```
┌─────────────┐     HTTP      ┌────────────────────┐
│   Browser   │ ────────────► │  app  (Next.js 16)  │
└─────────────┘               │  port 3010          │
                              └────────┬───────────-┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                   ▼
             ┌────────────┐   ┌──────────────┐   ┌──────────────┐
             │ PostgreSQL │   │    Redis      │   │  Vertex AI   │
             │ (pgvector) │   │  (cache /     │   │  (embeddings │
             │  port 55433│   │  rate-limit)  │   │   + chat)    │
             └────────────┘   └──────────────┘   └──────────────┘
                    ▲
                    │  writes chunks & embeddings
             ┌──────────────┐
             │   indexer    │  cron-based background process
             │              │  sources: web, GitHub orgs,
             │              │           raw GitHub docs,
             │              │           static seed docs
             └──────────────┘
```

### Services

| Service     | Description                                                     | Port (host) |
|-------------|-----------------------------------------------------------------|-------------|
| `app`       | Next.js web UI + `/api/chat` endpoint                          | `3010`      |
| `indexer`   | Long-running Node process; ingests content on cron + startup   | —           |
| `postgres`  | pgvector-enabled PostgreSQL; stores chunks, embeddings, logs   | `55433`     |
| `redis`     | Response cache and rate-limiting                                | `56379`     |

### Data sources indexed

- **Static seed docs** — bundled markdown files (daily at 03:17 UTC)
- **Curated GitHub docs** — selected markdown from `logos-co/logos-docs`, `logos-co/logos-lips`, `logos-blockchain/logos-blockchain-specs` (daily at 03:37 UTC)
- **Web crawl** — logos.co, build.logos.co, docs.waku.org, press.logos.co, blog.nomos.tech (daily at 04:23 UTC)
- **GitHub orgs** — all public non-archived repos from `logos-co` and `logos-blockchain` (daily at 03:41 UTC)

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) ≥ 24 with Compose v2
- A Google Cloud project with **Vertex AI API** enabled
- A GCP service account JSON key with `Vertex AI User` role

---

## Deployment

### 1. Clone the repository

```bash
git clone https://github.com/citizenweb3/ai-integrations.git
cd ai-integrations
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in the required values:

```env
# PostgreSQL password (user/db are hardcoded as logos/logos_chatbot)
POSTGRES_PASSWORD=changeme

# Google Cloud project ID for Vertex AI
GOOGLE_CLOUD_PROJECT=your-gcp-project-id

# GitHub personal access token (optional; increases rate limit from 60 to 5000 req/h)
GITHUB_API_TOKEN=ghp_...
```

### 3. Add the GCP service account key

The app and indexer expect the JSON key at `./secrets/gcp-sa.json`:

```bash
mkdir -p secrets
cp /path/to/your-sa-key.json secrets/gcp-sa.json
```

### 4. Start all services

```bash
docker compose -f docker-compose.dev.yml up --build
```

Docker Compose will:
1. Start PostgreSQL and Redis
2. Run database migrations (`drizzle-kit migrate`)
3. Build and start the `app` and `indexer` containers

The web UI is available at **http://localhost:3010** once the `app` container is healthy.

### 5. Verify the indexer

The indexer runs an initial pass on startup and then follows its cron schedules. Watch its logs:

```bash
docker compose -f docker-compose.dev.yml logs -f indexer
```

---

## Development (local)

> Requires Node.js 22 and Yarn 1.x.

### Start infrastructure only

```bash
docker compose -f docker-compose.dev.yml up postgres redis --build
```

### Install dependencies and run migrations

```bash
yarn install
yarn db:migrate
```

### Run the Next.js dev server

```bash
yarn dev
# → http://localhost:3000
```

### Run the indexer once (with mocked embeddings)

```bash
yarn indexer:once
```

### Smoke tests

| Script | What it checks |
|---|---|
| `yarn smoke:retrieval` | Embedding + retrieval pipeline |
| `yarn smoke:indexer` | Full indexer one-shot pass |
| `yarn smoke:chat-api` | Chat API end-to-end |
| `yarn smoke:web-indexer` | Web crawler pipeline |
| `yarn smoke:github-indexer` | GitHub crawler pipeline |
| `yarn audit:rag` | RAG quality audit |

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_PASSWORD` | Yes | `logos` | PostgreSQL password |
| `GOOGLE_CLOUD_PROJECT` | Yes | — | GCP project ID for Vertex AI |
| `GOOGLE_APPLICATION_CREDENTIALS` | Auto (Docker) | — | Path to GCP SA JSON (set by Compose) |
| `GITHUB_API_TOKEN` | No | — | GitHub PAT for higher API rate limits |
| `RETRIEVAL_MOCK_EMBEDDINGS` | No | `0` | Set to `1` to skip Vertex calls in the app |
| `INDEXER_MOCK_EMBEDDINGS` | No | `0` | Set to `1` to skip Vertex calls in the indexer |

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend / API | Next.js 16, React 19, Tailwind CSS v4 |
| AI / LLM | AI SDK v6, Google Vertex AI (Gemini) |
| Embeddings | `text-embedding-004` via Vertex AI, 768 dimensions |
| Database | PostgreSQL 16 + pgvector (HNSW index + full-text `tsvector`) |
| ORM / migrations | Drizzle ORM + drizzle-kit |
| Cache / rate-limit | Redis 7 via ioredis |
| Containerisation | Docker Compose |
| Language | TypeScript 6, Node.js 22 |
| Package manager | Yarn 1.x |

---

## License

[MIT](./LICENSE) © Citizen Web3
