"""ADK function tools for Aida's agents.

Each public coroutine here is registered as an ADK tool (the docstring is what
the model sees). Tools return strings (JSON or formatted text); errors are
returned to the model rather than raised, so a tool failure degrades to "no
grounding" instead of crashing the run.
"""

from __future__ import annotations

import asyncio
import json
import os
import re

_SELECT_RE = re.compile(r"^\s*(?:with\b.+?\bselect\b|select)\b", re.IGNORECASE | re.DOTALL)
_FORBIDDEN = (
    "insert", "update", "delete", "drop", "alter", "create",
    "truncate", "grant", "revoke", "copy", "--", "/*",
)


def is_safe_select(sql: str) -> bool:
    """True only for a single read-only SELECT (incl. leading CTE). Defence in
    depth on top of a read-only DB role: no writes, no multi-statement, no comments."""
    if not sql or not sql.strip():
        return False
    stripped = sql.strip().rstrip(";")
    if ";" in stripped:  # reject multi-statement
        return False
    if not _SELECT_RE.match(stripped):
        return False
    low = stripped.lower()
    return not any(tok in low for tok in _FORBIDDEN)


async def query_validatorinfo(sql: str) -> str:
    """Query ValidatorInfo on-chain Postgres (read-only SELECT). Returns JSON rows.

    Use for validator/staking/governance facts: voting power, uptime, proposals,
    commission, APR. Only a single SELECT statement is permitted.
    """
    if not is_safe_select(sql):
        return json.dumps({"error": "only a single read-only SELECT is allowed"})
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn:
        return json.dumps({"error": "DATABASE_URL not set"})
    import asyncpg

    try:
        conn = await asyncpg.connect(dsn, timeout=5)
        try:
            await conn.execute("SET statement_timeout = 5000")
            rows = await asyncio.wait_for(conn.fetch(sql), timeout=5)
        finally:
            await conn.close()
        return json.dumps([dict(r) for r in rows], default=str)
    except Exception as e:  # noqa: BLE001 — surface error to the model, do not crash the run
        return json.dumps({"error": str(e)})
