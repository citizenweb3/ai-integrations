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


_SCHEMA_ERROR_TYPES = {
    "UndefinedColumnError": "UndefinedColumn",
    "UndefinedTableError": "UndefinedTable",
}


def _enrich_error(error: Exception, schema_dump: dict[str, list[str]]) -> str:
    """Build a structured JSON response for a Postgres error.

    For schema errors (UndefinedColumn / UndefinedTable) the response carries
    the real `available_tables` so the LLM can correct against actual data,
    plus `retry: False` to discourage the AFC layer from blind retry loops.
    For all other errors the schema dump is omitted (irrelevant) but
    `retry: False` is preserved — silent retry is never useful here.
    """
    err_class = type(error).__name__
    payload: dict = {
        "error": str(error),
        "retry": False,
    }
    if err_class in _SCHEMA_ERROR_TYPES:
        payload["error_type"] = _SCHEMA_ERROR_TYPES[err_class]
        payload["available_tables"] = schema_dump
        payload["hint"] = (
            "Schema is fixed and small. Either rewrite the SELECT against "
            "available_tables, switch to search_rag, or skip the claim. "
            "Do not retry the same query path with a different guess."
        )
    return json.dumps(payload, default=str)


async def _fetch_schema_dump(conn) -> dict[str, list[str]]:
    """Return {table_name: [column1, column2, ...]} for the public schema.

    Cheap single query against information_schema; used to enrich
    schema-error responses with real column lists.
    """
    rows = await conn.fetch(
        """
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
        """
    )
    schema: dict[str, list[str]] = {}
    for row in rows:
        schema.setdefault(row["table_name"], []).append(row["column_name"])
    return schema


_QUERY_TIMEOUT_FIRST_S = 5
_QUERY_TIMEOUT_RETRY_S = 15


async def query_validatorinfo(sql: str) -> str:
    """Query ValidatorInfo on-chain Postgres (read-only SELECT). Returns JSON rows.

    Use for validator/staking/governance facts grounded in real on-chain data:
    APR, commission rate, jailed status, uptime, proposal status, delegators
    count, validator identity. The full table catalog is loaded into the
    system prompt at startup; consult it before writing SQL. Only a single
    SELECT statement is permitted.

    Error response shape: `{"error": "...", "retry": false, "error_type": ...}`.
    On schema errors (UndefinedColumn / UndefinedTable) the response also
    contains `available_tables: {table: [columns]}` and a `hint`. When
    `retry: false` is set, do not re-issue another guess — rewrite against
    `available_tables`, switch to search_rag, or skip the claim.

    Smart I/O handling:
    - empty result set: returns `[]` — the LLM decides whether to narrow
      the claim or pivot. No retry hint, because the query succeeded.
    - timeout: ONE internal retry with a larger budget; a second timeout
      returns `error_type: "Timeout"` with `retry: false`.
    - DB unreachable / connect refused: non-retry error
      (`error_type: "ConnectFailed"`).
    - schema error: enriched response with real columns (see _enrich_error).
    """
    log.info("tool_query_validatorinfo_called sql=%s", sql.replace("\n", " "))
    if not is_safe_select(sql):
        return json.dumps({"error": "only a single read-only SELECT is allowed", "retry": False})
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn:
        return json.dumps({"error": "DATABASE_URL not set", "retry": False})

    import asyncpg

    try:
        conn = await asyncpg.connect(dsn, timeout=5)
    except Exception as e:  # noqa: BLE001 — surface error to the model
        log.warning("tool_query_validatorinfo_connect_failed: %s: %s", type(e).__name__, e)
        return json.dumps({
            "error": str(e),
            "error_type": "ConnectFailed",
            "retry": False,
        })

    try:
        # One retry on TimeoutError with a larger budget. All other errors
        # take their dedicated handler (schema → enrich, anything else →
        # plain non-retry).
        for attempt, budget_s in enumerate(
            (_QUERY_TIMEOUT_FIRST_S, _QUERY_TIMEOUT_RETRY_S), start=1
        ):
            try:
                await conn.execute(f"SET statement_timeout = {budget_s * 1000}")
                rows = await asyncio.wait_for(conn.fetch(sql), timeout=budget_s)
                log.info("tool_query_validatorinfo_ok rows=%d attempt=%d", len(rows), attempt)
                return json.dumps([dict(r) for r in rows], default=str)
            except (asyncpg.UndefinedColumnError, asyncpg.UndefinedTableError) as e:
                log.warning("tool_query_validatorinfo_failed: %s: %s", type(e).__name__, e)
                try:
                    schema = await _fetch_schema_dump(conn)
                except Exception as inner:  # noqa: BLE001 — schema dump is best-effort
                    log.warning("schema_dump_failed: %s: %s", type(inner).__name__, inner)
                    schema = {}
                return _enrich_error(e, schema)
            except asyncio.TimeoutError as e:
                if attempt == 1:
                    log.warning(
                        "tool_query_validatorinfo_timeout attempt=%d, retrying with budget=%ds",
                        attempt, _QUERY_TIMEOUT_RETRY_S,
                    )
                    continue
                log.warning("tool_query_validatorinfo_timeout attempt=%d giving up", attempt)
                return json.dumps({
                    "error": str(e) or "query timed out",
                    "error_type": "Timeout",
                    "retry": False,
                })
            except Exception as e:  # noqa: BLE001 — surface error to the model
                log.warning("tool_query_validatorinfo_failed: %s: %s", type(e).__name__, e)
                return _enrich_error(e, {})
        # Defensive: the loop always returns. Keeps static analysis happy
        # and guards against future edits that might fall off the end.
        return json.dumps({"error": "unexpected control flow", "retry": False})
    finally:
        await conn.close()


async def _rag_fetch(query: str, limit: int) -> list[dict]:
    """HTTP call to the RAG search API. Isolated for mocking in tests."""
    import aiohttp

    base = os.environ.get("RAG_API_URL", "http://host.docker.internal:3000").rstrip("/")
    token = os.environ.get("RAG_API_TOKEN", "")
    params = urlencode({"q": query, "limit": str(limit)})
    url = f"{base}/api/rag/search?{params}"
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(url, headers={"x-rag-api-token": token}) as resp:
            data = await resp.json()
    return data.get("results", []) if isinstance(data, dict) else []


async def search_rag(query: str, limit: int = 5) -> str:
    """Search CitizenWeb3 podcast transcripts. Returns quote + speaker + episode.

    Use to back a claim with a real attributed podcast quote. Do NOT invent quotes.
    """
    log.info("tool_search_rag_called query=%r limit=%d", query, limit)
    try:
        results = await _rag_fetch(query, limit)
    except Exception as e:  # noqa: BLE001 — surface error to the model
        log.warning("tool_search_rag_failed: %s: %s", type(e).__name__, e)
        return json.dumps({"error": str(e)})
    log.info("tool_search_rag_ok results=%d", len(results))
    if not results:
        return "no podcast quotes found"
    lines: list[str] = []
    for r in results:
        lines.append(f'- "{r.get("quote", "")}"')
        speaker = r.get("speakerName") or "?"
        role = r.get("speakerRole") or ""
        if role:
            # Surface HOST/GUEST role so the LLM can apply CW3 disclosure
            # rules in cite mode (see prompts/system.md §6, §7).
            speaker = f"{speaker} ({role})"
        lines.append(f'  Speaker: {speaker}, Episode: {r.get("episodeTitle", "")}')
        lines.append(f'  URL: {r.get("episodeUrl", "")}')
    return "\n".join(lines)
