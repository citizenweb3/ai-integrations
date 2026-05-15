# Indexer Notes

The indexer is a separate Docker service. Keep it runnable both as a long-lived cron process and as a one-shot worker with `INDEXER_RUN_ONCE=1`.

Use the existing service layer for database writes:

- `sourceService` for `logos_sources`
- `chunkService` for `logos_chunks`
- `embeddingService` for Gemini embeddings

Do not import `@/db` directly unless a pipeline step cannot be expressed through a service method. Prefer adding a focused service method first.

Indexer jobs should be idempotent. Re-running a job must not create duplicate sources or duplicate chunks.
