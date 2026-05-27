# 0002 — Split research_snapshot into research + contact-discovery stages

| Field | Value |
|---|---|
| **Date** | 2026-05-27 |
| **Status** | Accepted — implemented in T-026M |
| **Affected phases** | Phase 1 (agent runtime), Phase 3/4 (enrichment → drafting) |
| **Closes gap** | G4.2 (E2E Production-Readiness Gaps, Step 4) |

---

## TL;DR

The `research_snapshot` ADK stage produced three artifact classes —
`facts`, `questions`, and `contactCandidates` — in one JSON envelope. The agent
had to trade depth on one concern for another (a contact-heavy run yields a
thin snapshot, and vice versa), and a single prompt could not be tuned per
concern. We split contact discovery into its own `contact_candidate_discovery`
stage, chained after the snapshot lands.

## Context

Canonical §20 D names `research_snapshot` and `research_more` as research
stages and lists `contact_candidate_discovery` as a separate concern. The MVP
implementation collapsed all three into the research prompt for expediency.

## Decision

Two stages, sequential chain (**invocation model A**, chosen by the operator):

- `research_snapshot` / `research_more` emit `{ summary, facts[], questions[] }`
  only.
- `contact_candidate_discovery` emits `{ contactCandidates[] }` only, with its
  own focused, tunable prompt and `google_search`.
- After a snapshot lands, the snapshot router enqueues a command-less
  `job.discover_contacts` for the same organization, sharing the per-org
  `research_snapshot:<org>` concurrency key so the two never run concurrently.

### Options considered

| Option | Summary | Verdict |
|---|---|---|
| **A — sequential chain** | snapshot router auto-enqueues `job.discover_contacts` | **Chosen.** Per-stage retry/concurrency stay clean; matches the system's job-per-stage / jobs-as-outbox model; mirrors the existing accept→enrichment chain; contact agent can later receive snapshot context. |
| B — one job, two ADK calls | one handler runs both stages | Rejected: couples two agent calls under one job's retry/rollback semantics. |
| C — parallel independent | accept enqueues both jobs | Rejected: contact discovery would run with no research context. |

Both A and B cost a second agent call (extra `google_search` budget); that is
the accepted price of focused prompts.

## Consequences

- Contact candidates land slightly after facts; the operator UI already shows
  pending candidates, so this is invisible in practice.
- Contact persistence (normalize + in-run dedup + cross-run merge + insert) is
  shared by both routers via `routeContactCandidatesIntoOrg`, under one per-org
  advisory lock — the two routers cannot race.
- The `skipEnrichment` accept path (T-026K) skips the research job entirely, so
  it also skips the contact chain — correct.
- Implemented across T-026M in three commits (Python stage add → worker/DB wire
  + chain → research-prompt cleanup) so each commit left a working system.
