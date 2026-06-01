# T-026BF — Model retry + failover on 429 (RESOURCE_EXHAUSTED)

**Date:** 2026-06-01
**Status:** Design accepted, ready for implementation
**Scope:** `apps/agent` (Python ADK runtime). No worker/dashboard/db change.

## Problem

A `job.generate_cold_draft` dead-lettered with `429 RESOURCE_EXHAUSTED`
from Vertex/Gemini. The draft stages run on `gemini-3.1-pro-preview` — a
preview model with a small, easily-exhausted quota. The worker retried the
job 5× but every attempt hit the *same* model, so all 5 returned 429 and
the job dead-lettered. There is no model failover anywhere in the agent:
`resolve_model(stage)` returns a single model id and `build_agent` bakes it
in; `stream_stage` runs once and surfaces any error as `run_failed`.

This realizes decision #152 ("Model/provider fallback is explicit,
stage-configured, used only for provider/runtime availability failures")
which was never implemented.

## Goal

In-process retry-with-backoff on transient 429, then failover to a
configured fallback model, for every stage. The fallback for the draft
stages is `gemini-3.5-flash` — a GA model with a large quota that the
research/discovery stages already use successfully. Quality stays on the
pro-preview primary; flash is the reliability backstop so a draft is
produced rather than dead-lettered.

Two retry layers, complementary not duplicated:
- **Agent (seconds, in-process):** backoff on the current model (transient
  RPM 429 usually clears in 1-10s), then failover down the model chain.
  Resolves the common case within one job run.
- **Worker (minutes, between jobs):** unchanged. The last-resort backstop
  if the whole chain fails or the agent service is unavailable.

## Decisions

1. **All stages** get retry + failover via a shared mechanism in
   `stream_stage`. Stages with no configured fallback still get backoff
   retry (chain of one).
2. **Backoff on primary first, then failover.** 429 RPM often clears in
   seconds, so retry the current model 3× with exponential backoff before
   switching — avoids needlessly degrading to flash when pro would free up.
3. **Two layers, worker retry unchanged** — escalation, not duplication.
4. **Failover chain for draft stages = `gemini-3.5-flash`.** Large quota,
   GA, already proven on the project; separate quota pool from pro-preview.

## Configuration (`model_policy.py`)

`resolve_model(stage)` stays (single primary, used by callers that don't
failover). New `resolve_model_chain(stage) -> list[str]`:

1. primary = `resolve_model(stage)` (existing logic).
2. fallbacks = `AGENT_<STAGE>_MODEL_FALLBACK` (comma-split) else
   `AGENT_DEFAULT_MODEL_FALLBACK`.
3. dedup (drop fallback == primary), preserve order.
4. no fallback configured → `[primary]` (backwards compatible).

env defaults (`.env` + `.env.example`):
```
AGENT_DRAFT_EMAIL_MODEL_FALLBACK=gemini-3.5-flash
AGENT_DRAFT_WARM_EMAIL_MODEL_FALLBACK=gemini-3.5-flash
AGENT_REVISE_EMAIL_MODEL_FALLBACK=gemini-3.5-flash
```
Research/discovery/validate already run on flash — no fallback needed
(chain of one; backoff retry still applies).

## Agent factory (`agents.py`)

`build_agent(stage, model: str | None = None)` — optional model override.
`model or resolve_model(stage)`. Refactor the 11 if-branches into a
`_STAGE_SPEC: {stage: (agent_name, instruction)}` table so the override is
threaded once, not per-branch. Instruction constants and `_STAGE_TOOLS`
unchanged. `build_agent` stays a pure factory; the chain/retry orchestration
lives in `stream_stage`.

## Retry + failover (`runner.py`)

```
chain = resolve_model_chain(stage)
for model_index, model in enumerate(chain):
    for attempt in range(MAX_ATTEMPTS_PER_MODEL):   # default 3
        try:
            <fresh InMemoryRunner(build_agent(stage, model)) + new session;
             buffer final text; emit model_chunk for progress>
            yield run_succeeded (+ model); return
        except 429:
            if attempt < last: await sleep(backoff(attempt)); continue
            else: break                              # failover to next model
        except other:
            yield run_failed; return                 # non-429 not retried
yield run_failed (error: "all models exhausted")
```

- **429 detection:** `_is_resource_exhausted(exc)` — match ADK/Google
  `ResourceExhausted`/`ClientError` types, fallback to `"429"` /
  `"RESOURCE_EXHAUSTED"` substring in `str(exc)`.
- **Streaming safety:** buffer text per attempt; emit `final_response` only
  on success, so a 429 mid-stream cannot duplicate text on retry. A fresh
  session per attempt prevents carrying failed-attempt ADK state.
- **New events (audit, decision #154):** `model_attempt`
  `{stage, model, attempt, model_index}`; `model_failover`
  `{from_model, to_model, reason}`; `run_succeeded` gains `model`.
- **Constants:** `MAX_ATTEMPTS_PER_MODEL=3`, backoff
  `min(base * 2^attempt, 8s)` + jitter. env overrides
  `AGENT_RETRY_MAX_ATTEMPTS`, `AGENT_RETRY_BASE_DELAY_MS`.

## Tests (`apps/agent/tests/`, pytest + pytest-asyncio — new)

Add `pytest`, `pytest-asyncio` to `pyproject.toml` optional `dev` deps.

- `test_model_policy.py` — chain: no fallback → `[primary]`; with
  `*_FALLBACK` → `[primary, fallback]`; dedup primary==fallback; shared
  `AGENT_DEFAULT_MODEL_FALLBACK`.
- `test_runner_failover.py` — mock `runner.run_async` (and backoff sleep):
  (1) 429 then success on retry, same model; (2) primary exhausted →
  failover to chain[1], emits `model_failover`; (3) whole chain 429 →
  `run_failed` "all models exhausted"; (4) non-429 → `run_failed`
  immediately, no retry.

## Build impact

`apps/agent` only. Rebuild + recreate the agent container
(`docker compose build agent && docker compose up -d --force-recreate agent`).
Worker/dashboard/db untouched.

## Stages (atomic commits)

1. `model_policy` chain + `agents` override/refactor + `test_model_policy`.
2. `runner` retry/failover loop + `test_runner_failover`.
3. env defaults + agent rebuild + live verify (trigger a draft; observe
   failover to flash on 429, or a simulated/forced 429).
