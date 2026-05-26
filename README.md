# BizDev Outreach MVP

Local-first scaffold for the BizDev Outreach MVP.

## Runtime

- Dashboard: Next.js App Router, SSR-first.
- Worker: TypeScript system worker with Postgres-backed leasing; Python ADK stage runtime is integrated later behind worker stage adapters.
- Database: Postgres + pgvector, Drizzle schema/migrations.
- Coordination: `commands`, `jobs`, `job_runs`, `event_log`, and `work_items`.
- Ops: dashboard `/health`, worker heartbeats in Postgres, and Docker healthchecks.

## Local Start

```bash
cp .env.example .env
yarn install
docker compose up postgres -d
export DATABASE_URL=postgres://bizdev:bizdev@localhost:55432/bizdev
yarn db:migrate
yarn dev
```

Docker Compose exposes the dashboard on `http://localhost:3001` to avoid common local port `3000` conflicts.
Dashboard health is available at `http://localhost:3001/health`.
Resend delivery webhooks are accepted at `POST http://localhost:3001/webhooks/resend/events` and require Svix headers validated with `RESEND_WEBHOOK_SECRET_DELIVERY`. Resend inbound webhooks are accepted at `POST http://localhost:3001/webhooks/resend/inbound` and require `RESEND_WEBHOOK_SECRET_INBOUND`.
When exposing the dashboard through a domain or tunnel, set `DASHBOARD_BASIC_AUTH_USERNAME` and `DASHBOARD_BASIC_AUTH_PASSWORD`; webhook paths remain exempt and keep using provider signatures/secrets. If the agent is exposed beyond the Docker bridge, set the same `AGENT_RUN_SECRET` for the worker and agent so `POST /runs/{stage}` requires Bearer auth.

The first smoke path is:

1. POST `/api/commands` with `commandType=start_campaign`.
2. Dashboard persists a command and enqueues `job.start_campaign_expansion`.
3. Worker leases the job, writes `job_runs`, and appends business events.

## Operations docs

- [`docs/runtime-and-ops.md`](docs/runtime-and-ops.md) — process topology, env contract, day-1 bring-up, day-2 ops, failure-mode table.
- [`docs/backup-restore.md`](docs/backup-restore.md) — Postgres logical/physical backup procedures, restore flow, recovery contract.
- [`docs/security-audit.md`](docs/security-audit.md) — security override registry.
