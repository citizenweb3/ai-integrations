# Aida — Model & Effort Split

**Date:** 2026-04-17
**Goal:** Pin `--model` and `--effort` explicitly for every `claude -p` subprocess call. Predictable cost, no quality regression.

## Current State

`src/ai/responder.py` spawns `claude -p` subprocess with `--model` but no `--effort`. Two model slots in `config.yaml`:

- `claude.model` — reactive response
- `claude.model_reply` — reply/DM continuation

Verification (low-confidence recheck) inherits model from the initial call. Health check uses `_invoke` with default model.

## Target Mapping

| Context | Model | Effort | Rationale |
|---------|-------|--------|-----------|
| reactive | `claude-sonnet-4-6` | `medium` | First response on keyword match. 3 mandatory tool calls (query-db, WebSearch, RAG) + style constraints. Medium is enough. |
| reply | `claude-opus-4-6` | `high` | Conversation continuation + DM composition. Quality-critical. Prompts were written for Opus 4.6 — do NOT switch to 4.7 or Sonnet without prompt refactoring. |
| verification | `claude-sonnet-4-6` | `high` | Re-check of low-confidence drafts (< 0.8). Fact-checking via tools, not creative. Sonnet+high handles mandatory tool calls reliably. Main saving: Opus→Sonnet on reply-path low-confidence scenarios. |
| health_check | `claude-haiku-4-5-20251001` | `low` | Periodic ping. JSON echo, no tools. |

## Config Changes

Extend `claude` section in `config.yaml`:

```yaml
claude:
  model: "claude-sonnet-4-6"           # reactive
  effort: "medium"                     # NEW
  model_reply: "claude-opus-4-6"       # reply
  effort_reply: "high"                 # NEW
  model_verification: "claude-sonnet-4-6"  # NEW — previously inherited
  effort_verification: "high"          # NEW
  model_health: "claude-haiku-4-5-20251001"  # NEW — previously default
  effort_health: "low"                 # NEW
  timeout_seconds: 120
  max_concurrent: 3
  degraded_pause_minutes: 15
```

## Code Changes

**`src/ai/responder.py`:**

1. Load all four model/effort pairs from config in `__init__`.
2. `_invoke(prompt, model, effort)` — add `effort` parameter, append `--effort` to args.
3. `generate(prompt, use_reply_model=False, is_verification=False)` — add `is_verification` flag. When set, use `model_verification`/`effort_verification` regardless of `use_reply_model`.
4. `health_check()` — call `_invoke` with `model_health` + `effort_health`.

**`src/core/response_pipeline.py`:**

1. Second call (verification, line 136) must pass `is_verification=True`.
2. Update `model_used` log line (line 166) to reflect verification path.

## Rollback

Single-file rollback via git revert. No data migration. Config is backward-compatible if new keys missing (fall back to defaults in `Responder.__init__`).

## Test Plan

1. Start agent locally, trigger keyword match in a test group → verify reactive uses Sonnet+medium (check logs).
2. Reply to Aida's message → verify reply uses Opus+high.
3. Force low-confidence draft (if testable) → verify verification uses Sonnet+high, not Opus.
4. `health_check` on startup → verify Haiku+low.
5. Grep logs for `--model` and `--effort` flags on each subprocess spawn.

## Out of Scope

- Switching reply to Opus 4.7 (prompts not refactored for it).
- Switching reply to Sonnet (quality risk, not validated).
- Ollama (llama4) pre-filter — separate path, unchanged.
