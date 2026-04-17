# Llama Pre-Filter Implementation Handoff

**Date:** 2026-04-17
**Purpose:** Short post-compaction handoff for implementing the finalized Llama/Ollama pre-filter.

## User Goal

Implement the finalized Llama 4 Scout pre-filter for the Telegram Growth Agent.

Primary implementation prompt:

- `docs/plans/2026-04-17-codex-prompt.md`

Supporting design:

- `docs/plans/2026-04-17-llama-prefilter-design.md`

Read both before editing code. Treat `2026-04-17-codex-prompt.md` as the implementation source of truth.

## Final Decisions

- Use `aiohttp.ClientSession`, not `httpx`.
- Use the existing `RAGClient` lifecycle style: `start()` creates the HTTP session, `close()` closes it.
- Model is Q4, not 200k:
  - `model: "llama4:17b-scout-16e-instruct-q4_K_M"` is the Ollama tag on the server.
- Ollama runtime options are sent per request:
  - `num_ctx: 8192`
  - `num_predict: 256`
  - `temperature: 0`
  - `format: "json"`
  - `keep_alive: -1`
- Add best-effort startup warmup:
  - `warmup_on_start: true`
  - `warmup_timeout_seconds: 180`
  - warmup failure logs warning and does not fail startup or mark degraded.
- Server should also be configured with:
  - `OLLAMA_KEEP_ALIVE=-1`
  - `OLLAMA_NUM_PARALLEL=3`
- Split reactive/proactive policies:
  - `reactive_timeout_seconds: 120`
  - `proactive_timeout_seconds: 240`
  - `reactive_max_concurrent: 2`
  - `proactive_max_concurrent: 1`
  - `max_retries_reactive: 1`
  - `max_retries_proactive: 2`
  - `retry_delay_seconds: 5`
- `max_retries_*` means retries after the first attempt.
- App-side context limits for Llama prompt construction:
  - `reactive_context_messages: 3`
  - `proactive_context_messages: 30`
  - `reactive_context_tokens: 5500`
  - `proactive_context_tokens: 5500`
  - `max_message_tokens: 700`
- If exact token counting is not available, implement a conservative approximation behind a small helper so it can be replaced later.

## Routing Semantics

Reactive:

- Save message and update existing group/contact state first, as current code does.
- Reply-to-us messages bypass Llama and go directly to Claude reply model.
- Non-reply messages go through Llama only after the existing keyword/topic match.
- Send at most 3 prior messages as Llama context; do not duplicate the new message in context.
- Llama `skip` exits before Claude.
- Llama `pass`, timeout fallback, error fallback, and parse fallback continue to Claude.

Proactive:

- Keep existing `_score_thread() >= threshold` gate.
- Do not add a second strict keyword-only gate.
- Run every 30 minutes over a 45-minute window.
- Do not skip a group only because it has fewer than 3 unresponded messages.
- Send at most 30 prior messages from the candidate thread as Llama context; pass the final thread message separately.
- Candidate thread goes through Llama.
- Llama `skip` exits before Claude.
- Fallback decisions continue to Claude.

## Filter Output Contract

Llama must return compact strict JSON:

```json
{"respond": true, "reason": "staking question"}
```

or:

```json
{"respond": false, "reason": "unrelated announcement"}
```

Parser rules:

- Use `json.loads`.
- Require dict/object output.
- Require `respond` to be boolean.
- `reason` must be a short string, truncate to 8 words or a safe short length.
- Never parse with substring checks like `"true" in output`.
- Invalid JSON/shape becomes `parse_fallback`.

Router returns structured metadata:

```python
@dataclass
class FilterResult:
    should_respond: bool
    decision: str
    reason: str
    attempts: int
    latency_ms: int
    raw_output: str | None = None
    error: str | None = None
```

Decisions:

- `pass`
- `skip`
- `timeout_fallback`
- `error_fallback`
- `parse_fallback`
- `disabled`

## Filter Prompt Rules

Use the exact finalized prompt in `docs/plans/2026-04-17-codex-prompt.md`.

Important exclusions from earlier discussion:

- Do not include a DM/link-confirmation rule for `ok`, `yes`, `да`, `давай`, etc.
- Do not include an “already answered correctly by someone else” rule.
- Do not use broad fragile rules like “spam, ads, bot messages” in the old form.
- Include the conservative instruction: when uncertain, choose `respond=true`.

## Files Expected To Change

New:

- `src/ai/llm_router.py`

Modify:

- `config.yaml`
- `.env.example`
- `src/config.py`
- `main.py`
- `src/telegram/listener.py`
- `src/ai/proactive.py`
- `src/storage/db.py`
- `src/storage/cleanup.py`
- `src/storage/contacts.py`
- `src/telegram/approval.py`

Do not modify:

- `CLAUDE.md`
- `src/core/response_pipeline.py`
- `src/ai/responder.py`
- `src/telegram/sender.py`

`src/telegram/approval.py` is allowed only for a UI-only Llama metadata line in approval messages. Do not change approval callbacks, TTL, queue retry, delivery, or status transitions.

## Database Requirements

Add `llm_filter_log` to `SCHEMA` in `src/storage/db.py`; there is no `init_db()`.

Table:

```sql
CREATE TABLE IF NOT EXISTS llm_filter_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    chat_id INTEGER NOT NULL,
    message_id INTEGER,
    sender_id INTEGER,
    sender_name TEXT,
    decision TEXT NOT NULL,
    reason TEXT,
    latency_ms INTEGER,
    attempts INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
```

Indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_llm_filter_log_created ON llm_filter_log(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_filter_log_message ON llm_filter_log(chat_id, message_id);
CREATE INDEX IF NOT EXISTS idx_llm_filter_log_sender ON llm_filter_log(sender_id);
```

Methods:

- `save_filter_log(...)`
- `get_filter_log(chat_id, message_id)`
- `redact_filter_logs_for_sender(sender_id)`
- `cleanup_old_filter_logs(days)`

Do not store raw message text or full context in `llm_filter_log`.

## Privacy And Cleanup

- `/forget <user_id>` must redact `sender_name` in filter logs for that sender.
- Daily cleanup should delete or redact old filter logs using `database.audit_redaction_days` unless a separate setting is added.

## Approval Bot UI

If a matching filter log exists for `chat_id` + `in_reply_to`, show one line in the approval message:

```text
Llama: pass, 1420ms, attempts=1, reason=staking question
```

Fallback example:

```text
Llama: timeout_fallback, 245012ms, attempts=2
```

Reply-to-us messages bypass Llama and may show no Llama line.

## Verification Checklist

At minimum verify:

- `python -m compileall src`
- `ollama.enabled: false` preserves old Claude behavior.
- Reply-to-us bypasses Llama.
- Reactive keyword message with Llama `pass` calls Claude and logs `pass`.
- Reactive keyword message with Llama `skip` does not call Claude and logs `skip`.
- Timeout logs `timeout_fallback` and calls Claude.
- Invalid JSON logs `parse_fallback` and calls Claude.
- Proactive candidate uses `source="proactive"` and logs the decision.
- `/forget <user_id>` redacts filter log sender names.

## Current Working Tree Note

At handoff time, the two plan docs are untracked in git:

- `docs/plans/2026-04-17-codex-prompt.md`
- `docs/plans/2026-04-17-llama-prefilter-design.md`

Do not assume a clean worktree. Ignore unrelated untracked files unless they affect implementation.
