# Production-Readiness Tickets — Codex Handoff

Source of truth for design: `IMPLEMENTATION_STATUS.md` § "E2E Production-Readiness Gaps" (Steps 1–10).
Every ticket below cites the gap codes (G*) and fix codes (S*) it implements.

Read order for Codex: `HANDOFF.md` → this file → `CHECKPOINTS.md` → `IMPLEMENTATION_STATUS.md` (only the relevant Step sections per ticket).

---

## Ticket priority bands

| Band | Meaning | When to ship |
|------|---------|--------------|
| **P0** | Legal exposure, data loss, irreversible incidents, or production cannot run safely. | First wave. Blocks any send to real recipients. |
| **P1** | Observability + recovery primitives. Without these, P0 fixes cannot be operated. | Same sprint as P0. |
| **P2** | Per-step critical paths from `IMPLEMENTATION_STATUS.md`. Real correctness, not polish. | Wave 2. |
| **P3** | UX polish, scale headroom, schema hygiene. | Backlog. |

## Conventions for every ticket

- **Title** is short, present tense, problem-first.
- **G-refs** lists the gaps the ticket closes.
- **S-refs** lists the fix entries with concrete approach already drafted in `IMPLEMENTATION_STATUS.md`.
- **Files** lists exact paths the implementation must touch.
- **Acceptance** is binary checkable conditions.
- **Depends on** is a list of ticket IDs that MUST be merged first.
- **Risk** is one of `low / medium / high` — gates whether `gitnexus_impact` is mandatory before edit.

All migrations live in `packages/db/drizzle/migrations/` and follow the existing numbered-file convention (current head: `0029_*.sql` — check before adding).
All new repository helpers live in `packages/db/src/repositories.ts`.
All new dashboard routes live in `apps/dashboard/app/...`.
All new worker job handlers register inside `apps/worker/src/index.ts:runJob` switch.

---

# P0 — Legal / safety / incident response

## T-001 — Reply-unsubscribe writes hard suppression reason

- **G-refs:** G9.8
- **S-refs:** S9.2
- **Why now:** GDPR / CAN-SPAM exposure. Today an operator can re-send to a person who replied "please unsubscribe" because the suppression created from the reply uses `reason='user_unsubscribe'`, which is NOT in `hardSuppressionReasons` and therefore overridable.
- **Files:**
  - `packages/db/src/repositories.ts` — `applyReplyClassRouting`, branch `case "unsubscribe"` around line 8275: change `reason: 'user_unsubscribe'` → `reason: 'unsubscribe'`.
  - `packages/db/drizzle/migrations/<next>_backfill_user_unsubscribe.sql` — backfill `update suppressions set reason='unsubscribe' where reason='user_unsubscribe'`.
- **Acceptance:**
  - Existing test for reply-unsubscribe asserts the inserted suppression row has `reason='unsubscribe'`.
  - New test: after reply-unsubscribe, `evaluatePreSendGuardrails` for the same recipient returns a non-overridable failure with code `suppression_active`.
  - Migration runs idempotently on prod data; rows with no `user_unsubscribe` are untouched.
- **Depends on:** none
- **Risk:** medium (touches suppression semantics — `gitnexus_impact target="applyReplyClassRouting"` before edit)

## T-002 — `send_ambiguous` retry path completes correctly

- **G-refs:** G8.16
- **S-refs:** S8.5
- **Why now:** A `send_email` job that hits 5xx/408/429 → `ambiguous`. On retry, `transitionOutboundMessageStatus(from=['send_requested'], to='sent')` silently returns `false` because the row's status is `send_ambiguous`. The job marks itself completed but the outbound row stays `send_ambiguous` forever. The operator sees a stuck row with no error.
- **Files:**
  - `packages/db/src/repositories.ts` — `transitionOutboundMessageStatus` (around line 1500): when 0 rows are updated AND the row exists, throw a typed error `OutboundStatusTransitionError` instead of returning `false`. OR widen `fromStatuses` to accept `send_ambiguous` whenever the caller is the send-retry path.
  - `packages/db/src/repositories.ts` — `completeSendEmailJob` (lines 10898-10957): pass `fromStatuses=['send_requested','send_ambiguous']` for the success branch.
- **Acceptance:**
  - New integration test: outbound row in `send_ambiguous`, job runs to success — final row status is `sent` and event_log has `outbound_message_sent`.
  - New test: when `transitionOutboundMessageStatus` sees a row in an unexpected status, it throws and the job is marked `failed` (not `succeeded`).
- **Depends on:** none
- **Risk:** high (state machine — `gitnexus_impact target="transitionOutboundMessageStatus"` mandatory)

## T-003 — `approve_draft_for_send` ignores client-supplied body/subject/recipient

- **G-refs:** G8.1, G8.3
- **S-refs:** S8.1
- **Why now:** Dashboard handler at `apps/dashboard/app/api/commands/route.ts:863-906` reads `subject`, `body`, `recipientEmail`, `fromEmail` from FormData and passes them straight to `approveDraftForSendCommand`. A tampered POST can replace the entire payload. The command never cross-checks against `drafts` / `contacts` rows.
- **Files:**
  - `apps/dashboard/app/api/commands/route.ts:863-906` — replace FormData reads of `subject` / `body` / `recipientEmail` with a fetch by `draftId`; only accept `draftId`, `draftVersion`, `acknowledgedCodes`, `overrideReason` from the client.
  - `packages/db/src/repositories.ts` — `approveDraftForSendCommand`: resolve `subject`, `body`, `recipientEmail`, `fromEmail` inside the tx from `drafts`+`contacts` (single-row lock with `FOR UPDATE` already present); ignore any matching fields in `payload`.
  - `apps/dashboard/app/api/commands/route.ts` — remove the now-unused FormData fields.
- **Acceptance:**
  - New integration test: forged POST with `body='HACKED'` results in the outbound row's `payloadSnapshotJson.body` equal to the original draft body.
  - Telegram `/approve` path (`processTelegramInboundUpdate`) keeps working — it already resolves draft fields server-side; verify the helper used is the same.
- **Depends on:** none
- **Risk:** high (touches the canonical send command — `gitnexus_impact target="approveDraftForSendCommand"`)

## T-004 — `pause_all_sends` admin switch

- **G-refs:** G10.24
- **S-refs:** S10.1
- **Why now:** Only emergency stop today is killing the worker container. In-flight sends complete, queued sends silently restart on the next worker. There is no safe global circuit breaker.
- **Files:**
  - `packages/db/drizzle/migrations/<next>_system_state.sql` — new table `system_state(key TEXT PK, value JSONB, expires_at TIMESTAMPTZ, updated_at)`.
  - `packages/db/src/repositories.ts` — `pauseAllSendsCommand({actorId, reason, expiresAt?})` + `resumeAllSendsCommand` + helper `isSendsPaused()` returning `{paused:boolean, expiresAt, reason}`.
  - `packages/db/src/repositories.ts` — `evaluatePreSendGuardrails`: insert a non-overridable failure with code `system_pause` when `isSendsPaused()` is true.
  - `apps/dashboard/app/api/commands/route.ts` — accept `command_type='pause_all_sends'` and `resume_all_sends`.
  - `apps/dashboard/app/operations/page.tsx` — visible banner with "Sends paused since X, reason Y, expires Z" + "Resume" button.
- **Acceptance:**
  - Pause command flips state; subsequent `approve_draft_for_send` returns `system_pause` as non-overridable; existing `send_email` jobs already in flight still finish.
  - Resume command clears the state and the next `approve_draft_for_send` succeeds.
  - `system_pause` code is added to `nonOverridableGuardrailCodes` and `pre_send_guardrails_failed` event_log includes it.
- **Depends on:** none
- **Risk:** medium

## T-005 — Idempotent inbound webhook nonce store

- **G-refs:** G9.2
- **S-refs:** S9.17
- **Why now:** Resend webhook signature verification is correct but there is no replay-protection beyond it. An attacker with one captured signed body can replay it within the 300s drift window and the consumer will reprocess it.
- **Files:**
  - `packages/db/drizzle/migrations/<next>_webhook_event_nonces.sql` — new table `webhook_event_nonces(svix_id TEXT PRIMARY KEY, seen_at TIMESTAMPTZ DEFAULT now())`. Daily index cleanup migration.
  - `apps/dashboard/app/webhooks/resend/events/route.ts` — after signature verify and before `ingestResendWebhookEvent`, attempt `insert into webhook_event_nonces` with `onConflictDoNothing`; if conflict → return 200 with body `{deduplicated:true}` and skip ingest.
  - Nightly job (under T-018) prunes nonces older than 24h.
- **Acceptance:**
  - Same svix-id replayed within 24h short-circuits before `webhook_events` insert.
  - Different svix-ids with same body still proceed.
- **Depends on:** none
- **Risk:** low

---

# P1 — Observability + recovery primitives

## T-006 — Independent `recoverStaleJobs` watchdog

- **G-refs:** G10.4
- **S-refs:** S10.4
- **Why now:** Stale-job recovery runs only inside the worker poll loop. If all workers die (the moment recovery matters most), `leased` rows pile up forever.
- **Files:**
  - `packages/db/src/repositories.ts` — `ensureRecoverStaleJobsCronScheduled()` enqueues a background job `job.cron_recover_stale_jobs` every 60s (dedup by `availableAt` bucket, like `ensureResurfacePolicyStatesJobScheduled`).
  - `apps/worker/src/index.ts:runJob` switch — add `case "job.cron_recover_stale_jobs"`: call `recoverStaleJobs(workerId)` + re-enqueue self with `availableAt = now()+60s`.
  - Worker poll loop keeps calling `recoverStaleJobs` as a safety net (no change there).
- **Acceptance:**
  - Background pool worker schedules + executes the cron without operator action.
  - Stopping all `urgent`/`drafting` workers does not stop recovery — the cron self-perpetuates inside the `background` pool.
- **Depends on:** none
- **Risk:** low

## T-007 — Worker-down alert

- **G-refs:** G10.12
- **S-refs:** S10.2
- **Why now:** `worker_heartbeats.healthy=false` is a number on a page nobody is required to look at.
- **Files:**
  - `packages/db/src/repositories.ts` — `runWorkerHeartbeatWatchdog()`: select workers whose `last_seen_at < now() - 60s` AND `status='running'`; for each, emit `worker_unhealthy` event + enqueue `telegram_notification` with dedup key `worker_unhealthy:<workerId>:<bucket60s>`.
  - `apps/worker/src/index.ts:runJob` — register `case "job.cron_worker_heartbeat_watchdog"` (runs every 60s, self-rescheduling).
  - `packages/db/src/repositories.ts` — `ensureWorkerHeartbeatWatchdogScheduled()` boot helper called from worker startup like the policy resurface.
- **Acceptance:**
  - Kill a worker container; within ~2 min a telegram message appears.
  - Same outage does not emit a second message within the dedup bucket.
- **Depends on:** T-006 (uses the same cron pattern)
- **Risk:** low

## T-008 — Queue-depth watchdog

- **G-refs:** G10.10
- **S-refs:** S10.3
- **Why now:** If `job.send_email` queue grows because Resend is down, nobody is paged. Operator finds out by opening `/operations`.
- **Files:**
  - `packages/db/src/repositories.ts` — `runQueueDepthWatchdog()`: per `job_type`, count `status='queued'`; if > threshold (per-jobType from `system_config` row, default 100), emit `queue_backlog_detected` + telegram.
  - Worker job `job.cron_queue_depth_watchdog` (5-min cadence).
  - New table `system_config(key TEXT PK, value JSONB)` shared with T-004 (re-use, do not create twice).
- **Acceptance:**
  - Configurable per-jobType thresholds.
  - Dedup bucket prevents alert spam (one telegram per jobType per hour while sustained).
- **Depends on:** T-004 (shared `system_config` table), T-006
- **Risk:** low

## T-009 — `/health` per-subsystem detail

- **G-refs:** G10.6
- **S-refs:** S10.5
- **Why now:** `/health` is one bit. External probes / synthetic monitors / k8s liveness all need per-subsystem signals.
- **Files:**
  - `apps/dashboard/app/health/route.ts` — response shape becomes `{ok, database:{ok, latencyMs}, workers:{total, healthy, stale, oldestHeartbeatAge}, jobs:{queued, leased, deadLettered, oldestQueuedAge}, webhooks:{backlogCount}, suppressions:{hardCount}}`. Top-level `ok` is `database.ok && workers.healthy >= 1 && jobs.deadLettered < threshold`.
  - `packages/db/src/repositories.ts` — `getSystemHealth(maxWorkerAgeSeconds=30)` already returns most fields; extend with `oldestQueuedAge`, `oldestHeartbeatAge`, `suppressions.hardCount`, `database.latencyMs` (use `EXPLAIN ANALYZE` or simple round-trip timing).
- **Acceptance:**
  - Curl `/health` returns the documented shape.
  - When all workers stale, top-level `ok=false`.
  - Test: hardCount counts only `active_hard_suppression`.
- **Depends on:** none
- **Risk:** low

## T-010 — Structured logging via pino

- **G-refs:** G10.1
- **S-refs:** S10.20
- **Why now:** Single `console.log(JSON.stringify(...))` for worker, `console.error` for dashboard. No log-level control, no transports, no correlation propagation.
- **Files:**
  - `package.json` (workspace root) — add `pino` to `dependencies`.
  - `apps/worker/src/index.ts` — replace local `log()` with a `pino` logger; `LOG_LEVEL` env (default `info`).
  - `apps/dashboard/app/api/commands/route.ts` — replace `console.error` with the same logger.
  - `apps/dashboard/lib/logger.ts` — single export point.
- **Acceptance:**
  - All worker output is one JSON object per line with `ts/level/event/...` + `correlationId` when present.
  - `LOG_LEVEL=debug` reveals debug entries; `LOG_LEVEL=warn` hides info.
- **Depends on:** none
- **Risk:** low

## T-011 — `X-Request-Id` middleware

- **G-refs:** G10.18
- **S-refs:** S10.6
- **Why now:** Operator reports a 500. To find it in logs we currently match on timestamp. With a request id the user pastes the response header.
- **Files:**
  - `apps/dashboard/middleware.ts` — Next.js middleware writes a UUID to `X-Request-Id` if missing, propagates incoming if present, stores in AsyncLocalStorage.
  - `apps/dashboard/lib/request-context.ts` — getter for the current request id; consumed by `apps/dashboard/lib/logger.ts` (T-010) and by `appendEvent` (optional `requestId` field on `correlationId` slot).
- **Acceptance:**
  - Every response carries `X-Request-Id`.
  - Logs produced inside the request include the same id.
- **Depends on:** T-010
- **Risk:** low

---

# P2 — Per-step critical paths

Each P2 ticket bundles one Step's critical-path fixes from `IMPLEMENTATION_STATUS.md`. Codex should still split into smaller PRs per ticket if any single ticket exceeds ~600 LoC change.

## T-012 — Step 6 critical path: draft generation correctness

- **G-refs:** Step 6 G6.x critical-path subset
- **S-refs:** S6 critical-path subset (see Step 6 closing paragraph)
- **Files:** see `IMPLEMENTATION_STATUS.md` Step 6 acceptance per S-fix.
- **Acceptance:** per S-fix acceptance.
- **Depends on:** none
- **Risk:** medium

## T-013 — Step 7 critical path: operator review + claim safety

- **G-refs:** Step 7 critical-path subset
- **S-refs:** Step 7 closing paragraph
- **Depends on:** T-012
- **Risk:** medium

## T-014 — Step 8 critical path: pre-send guardrails depth + audit ordering

- **G-refs:** G8.x critical-path (G8.5 pre_send_override_applied audit, G8.6 sticky feedback, G8.7 idempotency-key derivation, G8.14 thread_active_send semantics)
- **S-refs:** S8.7 + S8.14 + S8.5 + S8.6
- **Depends on:** T-002, T-003
- **Risk:** high (`gitnexus_impact target="approveDraftForSendCommand"`, `target="evaluatePreSendGuardrails"`)

## T-015 — Step 9 critical path: classifier prompt + attach-inbound auto-classify + warm-draft dedup

- **G-refs:** G9.4 quote-strip, G9.7 attach-inbound classify, G9.13 warm dedup, G9.14 classifier context
- **S-refs:** S9.3 + S9.4 + S9.6 + S9.11
- **Depends on:** T-001
- **Risk:** medium

## T-016 — Telegram `/approve` soft-blocker override flow

- **G-refs:** G10.15
- **S-refs:** S10.18
- **Depends on:** T-003
- **Risk:** medium

## T-017 — Telegram pool isolation

- **G-refs:** G10.17
- **S-refs:** S10.19
- **Files:**
  - `.env.example` — add `telegram` to `WORKER_POOLS` default.
  - `packages/db/src/repositories.ts` — `enqueueTelegramNotificationJob` routes into `telegram` pool.
  - Compose: optional pinned `worker-telegram` service.
- **Depends on:** none
- **Risk:** low

## T-018 — Event-log retention + cost rollup + bundled nightly job suite

- **G-refs:** G10.7, G10.11, G10.21, G10.23
- **S-refs:** S10.7 + S10.8 + S10.9 + S10.10 + S10.23
- **Depends on:** T-006
- **Risk:** medium

---

# P3 — UX / scale headroom

## T-019 — Inbox saved-views + pagination

- **G-refs:** G10.8, G10.19
- **S-refs:** S10.12 + S10.13
- **Depends on:** none
- **Risk:** low

## T-020 — `/operations/events` live feed

- **G-refs:** G10.20
- **S-refs:** S10.14
- **Depends on:** none
- **Risk:** low

## T-021 — Per-jobType SLA panel

- **G-refs:** G10.13
- **S-refs:** S10.15
- **Depends on:** none
- **Risk:** low

## T-022 — Campaign progress roll-up

- **G-refs:** G10.22
- **S-refs:** S10.17
- **Depends on:** none
- **Risk:** low

## T-023 — `getOperationsCounters` 1-second cache

- **G-refs:** G10.9
- **S-refs:** S10.16
- **Depends on:** none
- **Risk:** low

## T-024 — DB-backed Telegram operator map

- **G-refs:** G10.16
- **S-refs:** S10.11
- **Depends on:** none
- **Risk:** low

## T-025 — Prometheus `/metrics` + OTLP skeleton

- **G-refs:** G10.2, G10.3
- **S-refs:** S10.21 + S10.22
- **Depends on:** T-010
- **Risk:** low

## T-026 — Per-step non-critical Step 1–5 polish

- **G-refs:** all non-critical-path Step 1–5 gaps
- **S-refs:** Step 1–5 non-critical S-fixes
- **Depends on:** none
- **Risk:** medium (split into sub-tickets per Step before starting)

## T-027 — Step 9 polish: subject fallback + ref cap + attachment manifest + noise collapse + merge_threads

- **G-refs:** G9.5, G9.16, G9.18, G9.19, G9.23
- **S-refs:** S9.14 + S9.12 + S9.16 + S9.19 + S9.18 + S9.20
- **Depends on:** T-015
- **Risk:** medium

## T-028 — Webhook secret separation (Resend inbound vs delivery)

- **G-refs:** G9.1
- **S-refs:** S9.1
- **Files:**
  - `.env.example` — split `RESEND_WEBHOOK_SECRET` into `RESEND_WEBHOOK_SECRET_DELIVERY` and `RESEND_WEBHOOK_SECRET_INBOUND`; the dashboard route picks based on event type or distinct path prefixes.
  - `apps/dashboard/app/webhooks/resend/events/route.ts` — accept both secrets, choose by route segment.
- **Depends on:** none
- **Risk:** low

---

# Out-of-scope for this batch

Anything calling for a brand-new product surface (e.g. operator-defined dashboards beyond saved views, multi-tenant scoping, billing) is NOT in this ticket list. Codex must refuse such scope-creep requests from the design doc unless they appear here.

# Total ticket count

28 tickets. Wave 1 (P0+P1) = 11 tickets. Wave 2 (P2) = 7 tickets. Wave 3 (P3) = 10 tickets.

# Final advice for Codex

1. Read `HANDOFF.md` first. Then this file. Then the matching Step section in `IMPLEMENTATION_STATUS.md` for the ticket you are picking up.
2. **Do not** invent new features. Every ticket is bounded by its S-refs.
3. **Do** run `gitnexus_impact` before editing any `high` risk symbol — block list noted on each ticket.
4. **Do** mark progress in `CHECKPOINTS.md` for every ticket as you change state.
5. Commit per ticket. Commit messages: `T-NNN: <short title>`. No "Co-Authored-By Claude" lines (user preference).
