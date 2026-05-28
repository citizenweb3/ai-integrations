# ai-integrations — Dev Notes

This repo is the Aida Telegram growth agent (Python, asyncio, Telethon + aiogram).

**Aida's runtime persona / decision gates / output schema live in
`prompts/system.md`** — that is the ADK `Agent.instruction` loaded by
`src/ai/instruction.py`. Do NOT mistake it for these dev instructions: this file
guides developers working in the repo; `prompts/system.md` guides Aida at runtime.

## Stack

- Python 3.12 venv at `.venv/` (`.venv/bin/python`, `.venv/bin/pytest`).
- LLM: Google Vertex AI + Gemini via `google-adk` (in-process `InMemoryRunner`)
  and `google.genai` (raw client for the router). Models per role in
  `config.yaml` `gemini:` block; Vertex creds via ADC
  (`secrets/vertex-sa.json`, `GOOGLE_APPLICATION_CREDENTIALS`). Gemini-3 models
  serve from `vertex.location: global` (regional 404s).
- Storage: SQLite (`data/agent.db`) + Postgres (ValidatorInfo, read-only role).
- RAG: external HTTP API (`RAG_API_URL`).

## Tests

```bash
.venv/bin/pytest -q
```

All tests must pass before commit. New code uses TDD (write failing test → fail
→ minimal implementation → pass → commit) per `superpowers:test-driven-development`.

## Branch / migration context

- `main` — production baseline (pre-migration).
- `aida-trust-first-rewrite` — trust-first persona rewrite (still on `claude -p`).
- `telegram-growth-agent-vertex` — current migration to Vertex+ADK+Gemini.
  Design/plan/journal in `docs/plans/2026-05-26-aida-*.md`.

## Commits

Conventional Commits. No Claude attribution / `Co-Authored-By` / `Generated with`
trailer (see global memory `feedback_commit_attribution`).
