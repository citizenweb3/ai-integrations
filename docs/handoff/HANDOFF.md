# Codex Handoff — bizdev-email-agent Production Readiness

## TL;DR

The production-hardening pass on `bizdev-email-agent` is locally complete on `main`. Use this handoff package to audit the work, continue follow-up fixes, prepare a local history rewrite, or decide what to push later.

Three files are the entire interface between you and the previous design pass:

| File | Role |
|------|------|
| `IMPLEMENTATION_STATUS.md` § "E2E Production-Readiness Gaps" | The design/audit document. 10 Steps with G* gaps and S* fixes. Implemented fixes are marked `[done]`; unresolved gaps remain as backlog/history. |
| `docs/handoff/TICKETS.md` | The original 28-ticket implementation plan, banded P0–P3, with G* + S* refs, files, acceptance, dependencies, and risk. |
| `docs/handoff/CHECKPOINTS.md` | The final local progress board. It is now the source of truth for what landed, how it was verified, and which residual risks remain. |

Read those three documents in that order before touching code.

---

## What this project is

`bizdev-email-agent` is a campaign-driven cold + warm B2B email outreach platform. The product invariant is **zero auto-send**: every outbound email is operator-approved through the dashboard. The agent (Gemini via Vertex AI) drafts; the operator approves; the worker dispatches via Resend; Resend webhooks (delivery + inbound replies) flow back into the same Command / Job / Event loop.

Architecture in one paragraph:
- **Dashboard** (`apps/dashboard`, Next.js 15 App Router) is the operator UI + the HTTP entrypoint for webhooks + the command intake.
- **Worker** (`apps/worker`) is a Node process that leases jobs from Postgres (`for update skip locked`) and runs agent stages, dispatches sends, processes webhooks. Multiple worker pools (`urgent`, `drafting`, `background`) so latency-sensitive jobs don't queue behind slow ones.
- **DB** (`packages/db`, Drizzle + Postgres, pgvector) holds every domain entity AND the command + job + event journal. Idempotency lives on `commands.idempotency_key` (sha256 unique).
- **Agent** (`apps/agent`, Python + ADK + Vertex Gemini) is a small FastAPI service the worker calls per agent stage.
- **Shared** (`packages/shared`) holds zod schemas + idempotency-key builders shared between dashboard, worker, agent.

Canonical product design: `bizdev-outreach-mvp-canonical-design.md` (read sections referenced by each Step in `IMPLEMENTATION_STATUS.md`, particularly §11, §15, §20, §35, §44, §47, §62, §65, §66, §67, §69).

---

## What we did in the design pass (the work BEFORE you)

A 10-step E2E production-readiness audit. Each Step traces one canonical user flow from intake to closure, verifies the actual code (via `gitnexus_*` MCP tools + `deepcontext_*` MCP tools + manual `Read`), and writes the findings into `IMPLEMENTATION_STATUS.md` under "E2E Production-Readiness Gaps".

The 10 Steps are:

1. `start_campaign` / campaign lifecycle / expansion
2. `run_campaign_discovery` / agent search / dedupe / policy gate
3. `accept/reject_discovery_candidate` / audit
4. `refresh_research_snapshot` / RAG / claim safety
5. `approve/reject_contact_candidate` / contact CRUD
6. `generate_draft` / `completeGenerateDraftJob` / RAG retrieve / quality score
7. `/drafts/[id]` operator review / `recomputeDraftScores`
8. `approve_draft_for_send` / pre-send guardrail re-eval / outbound dispatch / Resend
9. inbound webhook / thread match / `classify_reply` / warm reply
10. observability / health / event_log / `work_items` inbox / Telegram bot loop

Each Step in `IMPLEMENTATION_STATUS.md` follows the same structure:
- **Current behavior** — what the code did at audit time, with file:line refs; later sections may include refreshed notes from code review after implementation.
- **Gaps vs. canonical §X** — numbered `G<step>.<n>` items, each pointing at a real divergence from the canonical design.
- **Minimum production fix** — numbered `S<step>.<n>` items, each a concrete fix scoped to the gap.
- **Critical path** — closing paragraph naming the 3–6 highest-priority S-fixes in that Step.

The design pass itself did **not** modify production code. The later implementation wave did, and all 28 planned tickets have since been merged locally into `main`.

---

## Current local state

The 28 tickets in `docs/handoff/TICKETS.md` have been implemented and merged locally:

- **P0 (T-001…T-005)** — 5/5 done.
- **P1 (T-006…T-011)** — 6/6 done.
- **P2 (T-012…T-018)** — 7/7 done.
- **P3 (T-019…T-028)** — 10/10 done.
- **Total** — 28/28 tickets done, all acceptance checkpoints ticked in `CHECKPOINTS.md`.
- **Remote state** — no remote PRs were pushed; all work is local.

A few rules of engagement for follow-up work:

1. **One ticket = one PR**, in most cases. If a ticket exceeds ~600 LoC change OR crosses three layers (DB migration + repo helper + UI), split it into sub-PRs and add sub-tickets to `CHECKPOINTS.md`.
2. **Every state transition belongs in `CHECKPOINTS.md`.** Change `state`, fill `owner`, paste the PR URL, write observations in `notes`. Tick the per-ticket acceptance checkboxes as you observe each one. Never delete a row.
3. **For `risk: high` symbols, run `gitnexus_impact` BEFORE editing** and attach the output to the PR description. CLAUDE.md mandates this.
4. **Migrations are numbered.** Read the head of `packages/db/drizzle/migrations/` before adding a new file; do not assume the number cited in a ticket is still free.
5. **Idempotency is non-negotiable.** Every new command must derive an `idempotencyKey` via the existing helpers in `packages/shared`. Never `new Date()` inside an idempotency key — that exact bug (T-015 / S9.6) is one of the design findings.
6. **No "Co-Authored-By Claude" in commits.** User preference from memory.
7. **Commit message format:** `T-NNN: <short title>` for ticket work. Use a plain `docs:` / `chore:` prefix for non-ticket maintenance.
8. **TDD.** Repository helpers + command handlers must land with unit + integration tests in the same PR. The acceptance criteria in every ticket are written as test assertions on purpose.

---

## The hard constraints you must not violate

These come from the canonical design and the user's repeated instructions across this project's history:

1. **Zero auto-send.** No code path may dispatch outbound email without an explicit operator command (`approve_draft_for_send` or `/approve` via Telegram). T-016 expands the Telegram path; it does NOT bypass operator approval.
2. **Hard suppression reasons** (`unsubscribe`, `complaint`, `hard_bounce`) are non-overridable. T-001 is exactly about correctly populating that enum on reply-unsubscribe. Do not introduce new soft codes that an operator could acknowledge to send to a hard-suppressed address.
3. **`commands.idempotency_key` is the dedup gate.** Any retry-able external trigger (webhook, telegram update, dashboard form) must derive a deterministic key. Reuse the existing builders in `packages/shared`.
4. **Single-tx + side-effect-job pattern.** Domain state change is committed in one transaction; side effects (telegram notification, agent call, Resend dispatch) are enqueued in the same transaction as `jobs` rows. Do not call external services inside the tx and do not commit twice.
5. **Audit rows BEFORE the action.** Bug G8.5 / S8.5 in the design is exactly this: `pre_send_override_applied` must land in `event_log` before the outbound row insert. If a crash happens between the two, the audit must already exist.
6. **No "fix forward" with magic fallbacks.** If a state machine sees an unexpected status, throw. The design specifically calls out silent `false` returns as G8.16 — do not introduce new ones.

---

## The MCP tools you have

This project is indexed by GitNexus and DeepContext. Both are reflected in `CLAUDE.md` at the repo root. Quick-reference:

| Tool | Use for |
|------|---------|
| `gitnexus_impact({target, direction:"upstream"})` | MANDATORY before editing any function. Returns blast radius. |
| `gitnexus_context({name})` | 360° view of a symbol — callers, callees, processes. |
| `gitnexus_query({query})` | Concept search across execution flows. |
| `gitnexus_rename({symbol_name, new_name, dry_run})` | Safe multi-file rename. Use instead of find-replace. |
| `gitnexus_detect_changes({scope:"staged"})` | Pre-commit scope check. MANDATORY before commit. |
| `deepcontext_search_codebase({query})` | Semantic search across the codebase. Faster than grep for concept-level questions. |
| `mcp__plugin_context7_context7__query-docs` | Up-to-date library docs (Drizzle, Next.js, ADK, etc.). Prefer this over web search for library API. |

If the index is stale, run `npx gitnexus analyze` in the repo root first.

---

## What "done" means for the whole batch

- All P0/P1/P2/P3 tickets are `merged` locally.
- `CHECKPOINTS.md` reflects the final state for every ticket.
- `IMPLEMENTATION_STATUS.md` keeps historical gaps, with implemented S-fixes marked `[done]`.
- `git status --short --branch` should be clean before handing off again.
- If this work is later pushed, decide first whether to keep the local commit history or rebase/squash it into a cleaner public history.

---

## How to resume from here

1. Run `git status --short --branch` and `npx gitnexus status`.
2. Read `docs/handoff/CHECKPOINTS.md` first for the actual landed state and verification notes.
3. Read `IMPLEMENTATION_STATUS.md` only for the remaining backlog/history; do not assume an unmarked historical gap is still current without checking the code.
4. If doing code work, branch off local `main`, run GitNexus impact before editing symbols, implement, verify, run `gitnexus_detect_changes`, then commit locally.
5. If doing release/history work, keep `memory.md` local and uncommitted.

---

## Known local work

No known unstaged work is expected at this handoff. The previous Vertex grounding URL filter + agent model pinning changes were committed during the local implementation wave. If `git status` is dirty, treat the diff as new local work and inspect it before editing.

---

## Where to ask vs. where to decide

- **Decide yourself:** anything within a ticket's S-refs scope. The design has already chosen the approach.
- **Ask the user:** new scope, schema changes the ticket didn't specify, deviations from the acceptance criteria, any "fix forward" instinct that the design explicitly rejects (G8.16 silent return, G9.13 `new Date()` in idempotency key, G10.24 pause-by-kill, etc.).
- **Open a follow-up ticket:** anything you discover mid-implementation that's NOT in the current ticket. Add a row to `CHECKPOINTS.md` with state `todo` and reference it from the original ticket's `notes`.

---

## A note on style

The user prefers short, specific, declarative output. No commentary on what you're "about to do". No restating the request. If you must explain a decision, do it in the PR description, not in a comment on the code.

Comments in code are rare and load-bearing only — see CLAUDE.md and the project's existing style. The existing repository has long teaching comments in `repositories.ts`; preserve that style when adding logic that future-you will need to re-derive.

Russian is the user's working language for chat. Code, PR titles, commit messages stay in English.

---

## End of handoff

You have the design, the original plan, and the completed checkpoint board. Start from `CHECKPOINTS.md`, then review code before reopening any historical gap.
