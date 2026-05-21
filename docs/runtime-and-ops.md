# Runtime and Local Ops

End-to-end notes for running the BizDev Outreach MVP locally and in a Docker Compose stack. Covers process topology, env contract, day-1 bring-up, day-2 ops, and the failure modes the operator needs to recognize.

## Process topology

Five long-running processes plus one one-shot:

| Process | Image / source | Purpose |
| --- | --- | --- |
| `postgres` | `pgvector/pgvector:pg17` | Durable state. Holds Drizzle schema, `jobs`, `event_log`, `rag_*`, `vector(1536)` columns. |
| `migrate` | `docker/worker.Dockerfile` (one-shot) | Runs `yarn db:migrate` on boot, blocks `dashboard` + `worker` until `service_completed_successfully`. |
| `dashboard` | `docker/dashboard.Dockerfile` | Next.js App Router. Operator UI + `POST /api/commands` + `POST /webhooks/resend/events` + `GET /health`. |
| `worker` | `docker/worker.Dockerfile` | TS leaser. Polls `jobs`, leases by `WORKER_POOLS`, dispatches per-type handler, writes `job_runs` + `event_log`. Owns RAG indexing + retrieval-side embedder. |
| `worker-telegram` | `docker/worker.Dockerfile` | Dedicated Telegram notification worker. Leases only the `telegram` pool so bot API latency/rate limits do not consume `urgent` send capacity. |
| `agent` | `docker/agent.Dockerfile` | Python ADK runtime (Vertex Gemini). Worker calls it over HTTP at `AGENT_BASE_URL`. Stages: `research`, `draft_email`, `draft_warm_email`, `revise_draft`, `revalidate_draft_claims`. |

The worker pool string (`urgent,drafting,background,telegram`) determines which job classes a given worker leases. Splitting pools across multiple worker processes is supported — the leaser is `FOR UPDATE SKIP LOCKED` on `jobs`, so two workers in the same pool race safely.

## Env contract

`.env.example` has the full local-dev defaults. Production-only values:

### Database
- `DATABASE_URL` — Postgres connection string. Local default points at `localhost:55432` (Compose-mapped). Inside Compose the apps use `postgres:5432`.

### Dashboard
- `DASHBOARD_PORT` — bound port inside the container (Compose maps `3001:3000`).
- `RESEND_WEBHOOK_SECRET_DELIVERY` — Svix-format secret, validated on every `/webhooks/resend/events` POST. The webhook handler returns `401` on signature mismatch and `200` on dedupe-key collision (replay-safe).
- `RESEND_WEBHOOK_SECRET_INBOUND` — Svix-format secret, validated on every `/webhooks/resend/inbound` POST. Rotate independently from the delivery secret.
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` — used by `sendEmailDispatcher`. Empty `RESEND_API_KEY` short-circuits to a non-retryable failed send (the worker won't burn retries against a missing key).

### Worker
- `WORKER_ID` — distinct per worker process. Rendered in `/operations` heartbeat table. Default `worker-<uuid>` keeps replicas from colliding.
- `WORKER_POOLS` — comma list of `urgent`, `drafting`, `background`, `telegram`. Job-class → pool mapping lives in `packages/shared/src/index.ts`; `job.send_telegram_notification` is intentionally isolated in `telegram`.
- `WORKER_POLL_INTERVAL_MS`, `WORKER_LEASE_SECONDS`, `WORKER_HEARTBEAT_INTERVAL_MS`, `WORKER_HEALTH_MAX_AGE_SECONDS` — leasing/heartbeat tuning. Defaults are tuned for local dev; production workloads should bump `WORKER_LEASE_SECONDS` to cover the longest expected stage runtime (currently `draft_warm_email`, ~30s p95).

### Agent (ADK / Vertex)
- `GOOGLE_GENAI_USE_VERTEXAI=TRUE` — agent boot enforces this. If `GOOGLE_API_KEY` is set it hard-fails so a stale env never silently routes back to the Developer API surface.
- `GOOGLE_CLOUD_PROJECT` — required.
- `GOOGLE_CLOUD_LOCATION` — defaults to `global`. Preview models (e.g. `gemini-3-flash-preview`) are served only on the global endpoint; switch to a region (e.g. `us-central1`) only when every stage uses GA model ids.
- `GOOGLE_APPLICATION_CREDENTIALS` — path to a service-account JSON inside the container. `docker-compose.yml` bind-mounts `${HOST_GCP_SA_JSON:-/dev/null}` to `/secrets/gcp-sa.json:ro`. The `/dev/null` fallback keeps `docker compose up` non-fatal when ADC is bound by other means (`gcloud auth application-default login` on the host).
- `AGENT_DEFAULT_MODEL` — Gemini model id used by stages without a per-stage override. Default `gemini-3-flash-preview` (research / classify_reply / validate_claims).
- `AGENT_DRAFT_EMAIL_MODEL` / `AGENT_DRAFT_WARM_EMAIL_MODEL` / `AGENT_REVISE_EMAIL_MODEL` — drafting + AI revise stages. Default `gemini-3.1-pro-preview` (gemini-3-pro-preview was discontinued 2026-03-26).
- IAM minimum: `roles/aiplatform.user` on the project. Production deployments should use workload identity (GKE) or the metadata server (Cloud Run / GCE) instead of a key file.

### Worker → Vertex (RAG embeddings)
- `RAG_EMBED_PROVIDER` — `stub` (default; deterministic zero-vector for CI / offline) or `vertex`.
- `VERTEX_PROJECT_ID`, `VERTEX_LOCATION` — when `RAG_EMBED_PROVIDER=vertex`. Worker raises on startup if provider is `vertex` but `VERTEX_PROJECT_ID` is unset.
- `VERTEX_RAG_EMBED_MODEL` — default `text-embedding-004`.
- `VERTEX_RAG_EMBED_DIMENSIONS` — default `1536`. Must match the schema-side `vector(N)` column; changing this requires a migration.

## Day-1 bring-up

Local (no Docker for the apps, just Postgres):

```bash
cp .env.example .env
yarn install
docker compose up postgres -d
export DATABASE_URL=postgres://bizdev:bizdev@localhost:55432/bizdev
yarn db:migrate
yarn dev   # runs dashboard + worker concurrently
```

Full Compose stack (dashboard + worker + agent + Postgres):

```bash
cp .env.example .env
# point GOOGLE_APPLICATION_CREDENTIALS at a real key, or:
export HOST_GCP_SA_JSON=$HOME/.config/gcloud/application_default_credentials.json
docker compose up --build
```

Smoke check: `curl http://localhost:3001/health` (dashboard), `curl http://127.0.0.1:8000/health` (agent). Worker has no HTTP surface — verify via `/operations` page or the `worker_started` line in container logs.

## Day-2 ops

### Triage entry point
`/operations` is the single dashboard. Renders worker heartbeats, queue depth (queued / leased / running / dead-lettered split by job type), webhook backlog, open ambiguity, policy blockers, unmatched inbound. Refresh-only (no auto-poll yet); reload to see live state.

Counters that should be zero in steady state:
- `Stale leases` — non-zero means a worker died mid-job. Auto-recovered on the next worker tick via `recoverStaleJobs`; persistent non-zero indicates the leaser tick is stalling.
- `Dead-lettered jobs` — a job exhausted its retry budget. Inspect `event_log` for the matching `job_dead_lettered` event; payload carries `policyMaxAttempts`, `jobClass`, `nonRetryable`, `finalFailureSeverity`.
- `Webhook backlog` (received/queued/processing/processing_failed) — Resend events that haven't been processed. Persistent non-zero means the webhook processor is failing or starved (check worker pool assignment).

### Job retry policy reference
`getJobRetryPolicy(jobType)` (in `@bizdev/shared`) is the source of truth.

| Class | Examples | Attempts | Backoff |
| --- | --- | --- | --- |
| A_outward | `job.send_email`, `job.send_telegram_notification` | 3 (5 for telegram) | 30s..600s |
| B_external_compute | every ADK stage, `job.index_rag_document` | 5 | 10s..300s |
| C_internal | `job.match_thread`, `job.recompute_work_items`, `job.process_webhook_event`, etc. | 5 | 5s..120s |

`NonRetryableJobError` short-circuits the retry loop and dead-letters immediately. Used for: missing payload fields, auth/quota gRPC codes from Vertex (3 / 7 / 9 / 16), suppression-class hard rejections.

### Background cron suite
Background workers call `ensureBackgroundCronsScheduled` at startup. The bundle registers the singleton self-rescheduling jobs for policy resurfacing, stale-job recovery, worker heartbeat watchdog, queue-depth watchdog, `job.cron_rotate_event_log`, and `job.cron_rollup_agent_costs`.

`rotate_event_log` archives hot `event_log` rows older than 90 days into `event_log_archive` before deleting them from the hot table. `rollup_agent_costs` reads `agent_runs.token_usage_json`, writes `agent_cost_daily` rows by `(usage_day, stage, campaign_id)`, and emits `agent_cost_spike` plus a Telegram notification when a day's estimated spend is greater than 3x the prior 7-day average for the same stage/campaign bucket.

`agentTokenUsageSchema` in `@bizdev/shared` is the contract for `agent_runs.token_usage_json`: `{promptTokens, completionTokens, totalTokens, modelId, costUsd?, latencyMs?}`. Backfill plan for legacy rows: extract provider usage metadata from retained `agent_run_events`/agent outputs when present, normalize it through `agentTokenUsageSchema`, update `agent_runs.token_usage_json`, then rerun `rollup_agent_costs` for each affected UTC day. Rows with no recoverable provider usage remain `{}` and are intentionally skipped by the rollup.

### Operator commands
All operator actions go through `POST /api/commands` (JSON or form-encoded). Idempotency keys are required and prefix-checked per command type — see `commandTypeIdempotencyPrefix` in `packages/shared`. Commands never mutate state directly; they enqueue jobs.

### Manual interventions
- **Worker stuck on a job**: kill the worker process. Lease expires after `WORKER_LEASE_SECONDS`, `recoverStaleJobs` resets it to `queued` on the next tick. The job re-runs with `attempts++`.
- **Dead-letter a stuck job manually**: `update jobs set status='dead_lettered', dead_lettered_at=now() where id=...` then append a `job_dead_lettered` event. There is no UI affordance yet.
- **Replay a webhook**: webhooks are dedupe-keyed by `(provider, provider_event_id)`. To force a replay, delete the matching `webhook_events` row before the upstream re-sends. The dedupe key is unique-indexed; `onConflictDoNothing` is the replay guard.

### Logs and observability
- Worker logs structured JSON to stdout: `{level, event, ...payload}`. Key events: `worker_started`, `job_succeeded`, `job_failed`, `policy_states_resurfaced`, `schema_compatible`.
- `event_log` is the persistent business-event audit. Append-only. Every command + every state transition writes here.
- `agent_runs` + `agent_run_events` capture each ADK stage invocation including the prompt size, output size, and full event stream. Use this to debug a malformed Gemini response.

## Failure modes worth recognizing

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Dashboard 500s on `/operations` | Postgres unreachable or schema mismatch | Check `DATABASE_URL`, run `yarn db:migrate`. |
| Worker exits immediately with `RAG_EMBED_PROVIDER=vertex but VERTEX_PROJECT_ID is not set` | Provider set without project | Either set `VERTEX_PROJECT_ID` or revert provider to `stub`. |
| Agent exits with `GOOGLE_API_KEY is set...` | Stale env still pointing at Developer API | Unset `GOOGLE_API_KEY`; only the Vertex env block is supported. |
| `rag_retrieval_failed` events appearing | Embedding provider transient outage | Drafts still generate (fallback to pre-RAG prompt). Fix Vertex creds / quota. |
| All jobs stuck in `queued` | No worker for that pool | Check `WORKER_POOLS` covers the job's class (`jobTypeToClass` in `@bizdev/shared`). |
| Approve-and-send rejected with `pending_suppression_webhook` | Suppression webhook hasn't been processed yet | Wait for the webhook backlog to drain, or process it manually. The guardrail closes a real race; do not bypass. |
