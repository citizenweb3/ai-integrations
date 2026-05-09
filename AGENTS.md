# Logos Chatbot Agent Notes

This repository is a fresh Docker-first Next.js implementation of the Logos onboarding chatbot.

## Architecture Rules

- The app is self-hosted through Docker Compose from the first ticket.
- Runtime services are `app`, `indexer`, `postgres`, and `redis`.
- Database access must stay behind service modules under `src/app/services/*` or `indexer/**`.
- The indexer is a separate long-running Node process. It owns cron scheduling and source ingestion.
- Keep chat logs in Postgres for RAG debugging and quality review. Do not build an admin UI for MVP.

## Implementation Notes

- Use AI SDK v6 APIs.
- Use Google embedding output dimensionality set to 768 and validate vector length.
- Keep `content_tsv` trigger-backed for MVP.
- Prefer Docker Compose verification over local-only checks.
