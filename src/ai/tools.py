"""ADK function tools for Aida's agents.

Each public coroutine here is registered as an ADK tool (the docstring is what
the model sees). Tools return strings (JSON or formatted text); errors are
returned to the model rather than raised, so a tool failure degrades to "no
grounding" instead of crashing the run.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from urllib.parse import urlencode

log = logging.getLogger(__name__)

_SELECT_RE = re.compile(r"^\s*(?:with\b.+?\bselect\b|select)\b", re.IGNORECASE | re.DOTALL)

# Word-boundary matched so legit identifiers (copy_of_validators, update_log,
# created_at) are NOT rejected. Covers DML/DDL, `SELECT ... INTO` table creation,
# and side-effecting / DoS / filesystem functions.
_FORBIDDEN_RE = re.compile(
    r"\b("
    r"insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|into|"
    r"setval|nextval|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|"
    r"pg_stat_file|lo_export|lo_import|dblink|pg_terminate_backend|pg_reload_conf"
    r")\b",
    re.IGNORECASE,
)


def is_safe_select(sql: str) -> bool:
    """True only for a single read-only SELECT (incl. leading CTE).

    NOTE: this is defence-in-depth, NOT the security boundary. The real boundary
    is the read-only Postgres role in `DATABASE_URL` (no write/DDL/EXECUTE grants).
    This check additionally blocks multi-statement, comments, write/DDL keywords,
    `SELECT ... INTO`, and known side-effecting / filesystem / DoS functions.
    """
    if not sql or not sql.strip():
        return False
    stripped = sql.strip().rstrip(";")
    if ";" in stripped:  # reject multi-statement
        return False
    if "--" in stripped or "/*" in stripped:  # reject comments
        return False
    if not _SELECT_RE.match(stripped):
        return False
    if _FORBIDDEN_RE.search(stripped):
        return False
    return True


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
        log.warning("tool_query_validatorinfo_failed: %s: %s", type(e).__name__, e)
        return json.dumps({"error": str(e)})


async def _rag_fetch(query: str, limit: int) -> list[dict]:
    """HTTP call to the RAG search API. Isolated for mocking in tests."""
    import aiohttp

    base = os.environ.get("RAG_API_URL", "http://host.docker.internal:3000").rstrip("/")
    token = os.environ.get("RAG_API_TOKEN", "")
    params = urlencode({"q": query, "limit": str(limit)})
    url = f"{base}/api/rag/search?{params}"
    timeout = aiohttp.ClientTimeout(total=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(url, headers={"x-rag-api-token": token}) as resp:
            data = await resp.json()
    return data.get("results", []) if isinstance(data, dict) else []


async def search_rag(query: str, limit: int = 5) -> str:
    """Search CitizenWeb3 podcast transcripts. Returns quote + speaker + episode.

    Use to back a claim with a real attributed podcast quote. Do NOT invent quotes.
    """
    try:
        results = await _rag_fetch(query, limit)
    except Exception as e:  # noqa: BLE001 — surface error to the model
        log.warning("tool_search_rag_failed: %s: %s", type(e).__name__, e)
        return json.dumps({"error": str(e)})
    if not results:
        return "no podcast quotes found"
    lines: list[str] = []
    for r in results:
        lines.append(f'- "{r.get("quote", "")}"')
        lines.append(f'  Speaker: {r.get("speakerName", "?")}, Episode: {r.get("episodeTitle", "")}')
        lines.append(f'  URL: {r.get("episodeUrl", "")}')
    return "\n".join(lines)
