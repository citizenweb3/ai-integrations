# Backup and Restore

Procedures for the two pieces of durable state the MVP owns:

1. **Postgres** — operator state, jobs, events, RAG documents/chunks/embeddings (`vector(1536)` columns via pgvector).
2. **Artifact volumes** — agent stage outputs (`agent_runs.outputArtifactJson` is in-DB, but if a future slice spills large artifacts to a `bizdev_artifacts` volume those need a separate backup leg).

Both are scoped to the local Compose stack. Production targets (Cloud SQL, GCS) inherit the same recovery contract but use managed snapshots.

## Postgres

### What lives in the database
- All operator state (`commands`, `jobs`, `job_runs`, `event_log`, `work_items`).
- All business state (`organizations`, `contacts`, `threads`, `inbound_messages`, `outbound_messages`, `drafts`, `draft_versions`, `claims`, `facts`).
- All RAG state (`rag_documents`, `rag_chunks`, `rag_embeddings` — the embeddings column is `vector(1536)` from pgvector, dumped/restored as text by `pg_dump`).
- All audit (`event_log` is append-only — never truncate).

### Local backup

The Compose volume is named `bizdev_postgres`. The data lives at `/var/lib/postgresql/data` inside the `pgvector/pgvector:pg17` container.

**Logical backup (preferred — portable across PG versions, supports partial restore):**

```bash
docker exec bizdev-postgres pg_dump \
  --username=bizdev \
  --dbname=bizdev \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file=/tmp/bizdev.dump

docker cp bizdev-postgres:/tmp/bizdev.dump ./backups/bizdev-$(date -u +%Y%m%dT%H%M%SZ).dump
```

`--format=custom` emits a binary dump that `pg_restore` can replay selectively. `--no-owner` / `--no-privileges` strip role grants so the dump replays cleanly into a freshly-initialized cluster.

**Physical backup (fastest restore, requires same major PG version + same pgvector version):**

```bash
# Stop the apps so no writes hit the WAL during the snapshot.
docker compose stop dashboard worker agent

# Snapshot the named volume by tarring its contents.
docker run --rm \
  -v bizdev_postgres:/var/lib/postgresql/data:ro \
  -v "$(pwd)/backups":/backup \
  alpine tar -C /var/lib/postgresql/data -czf /backup/pgdata-$(date -u +%Y%m%dT%H%M%SZ).tar.gz .

docker compose start postgres dashboard worker agent
```

Use logical for everyday backups; physical for fast disaster recovery.

### Local restore

**From a logical dump** (works against an already-running, empty `bizdev` database):

```bash
# Drop and re-create the database first so the restore lands on an empty schema.
docker exec bizdev-postgres psql -U bizdev -d postgres -c \
  "drop database if exists bizdev;"
docker exec bizdev-postgres psql -U bizdev -d postgres -c \
  "create database bizdev owner bizdev;"

docker cp ./backups/bizdev-<timestamp>.dump bizdev-postgres:/tmp/bizdev.dump
docker exec bizdev-postgres pg_restore \
  --username=bizdev \
  --dbname=bizdev \
  --no-owner \
  --no-privileges \
  /tmp/bizdev.dump
```

The `pgvector` extension is installed inside the dump (`CREATE EXTENSION` is included via Drizzle migration 0002). After restore, run `yarn db:migrate` to verify the schema is at the expected version — `assertSchemaCompatibility` will refuse to start the dashboard / worker against a mismatched schema.

**From a physical archive:**

```bash
docker compose down                  # stop everything; the volume must be unmounted
docker volume rm bizdev_postgres     # discard current state
docker volume create bizdev_postgres
docker run --rm \
  -v bizdev_postgres:/var/lib/postgresql/data \
  -v "$(pwd)/backups":/backup \
  alpine sh -c "tar -C /var/lib/postgresql/data -xzf /backup/pgdata-<timestamp>.tar.gz"
docker compose up -d
```

### Production posture

- Cloud SQL: enable automated backups (default daily) + PITR. Retention 7 days minimum.
- A logical dump should still run weekly into a separate bucket — the managed snapshot is opaque, the dump is portable across PG versions and recoverable manually.
- Never restore into the live primary; always restore into a side instance and cut over via `DATABASE_URL` swap so the broken state is preserved for forensics.

## Artifact volumes

The Compose file declares `bizdev_artifacts` but the MVP currently writes all agent artifacts inline as JSON on `agent_runs.outputArtifactJson`. **No file-system artifact backup is needed today** — the Postgres backup covers everything.

When a future slice spills large artifacts (e.g. raw research HTML, attachments) to disk:

```bash
docker run --rm \
  -v bizdev_artifacts:/data:ro \
  -v "$(pwd)/backups":/backup \
  alpine tar -C /data -czf /backup/artifacts-$(date -u +%Y%m%dT%H%M%SZ).tar.gz .
```

The artifact backup must be paired with the Postgres backup taken in the same window — `agent_runs` rows reference artifact ids; restoring one without the other yields dangling references.

## Recovery contract

The system is designed to tolerate restoring an older snapshot:

- Job processing is at-least-once; a restored job that already ran will re-run, and idempotency keys on commands + dedupe keys on outbound + webhook event uniqueness prevent duplicate side effects.
- `event_log` is append-only — restoring a stale snapshot will roll back recent audit entries. Operators must re-sync the audit by replaying webhook events from the upstream provider (Resend retains 7 days).
- RAG indexing is content-addressable by `(source_entity_type, source_entity_id)` — a restored snapshot picks up where it left off; orphan embeddings from re-indexed chunks are tolerated by retrieval (the join through `rag_chunks` drops them).

## Verification checklist after restore

1. `yarn db:migrate` — schema at expected version.
2. `curl http://localhost:3001/health` — 200 OK.
3. Worker logs show `worker_started` and `schema_compatible`.
4. `/operations` renders without errors; webhook backlog and dead-letter counters reflect snapshot state.
5. Spot-check `select count(*) from event_log;` against the pre-restore count to confirm the dump replayed completely.
