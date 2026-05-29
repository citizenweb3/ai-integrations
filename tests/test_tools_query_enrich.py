"""Tests for query_validatorinfo error enrichment (defense layer L3).

When a SELECT references a non-existent column or table, the tool returns
a structured JSON error containing the actual available schema so the LLM
can either retry against real columns or pivot away. The `retry: False`
flag instructs the LLM not to guess.
"""
import asyncio
import json

import asyncpg.exceptions as pg_exc

from src.ai.tools import _enrich_error


def test_enrich_undefined_column_attaches_schema_and_retry_false():
    err = pg_exc.UndefinedColumnError("column n.voting_power does not exist")
    schema = {
        "nodes": ["id", "moniker", "rate", "uptime", "jailed"],
        "validators": ["id", "identity", "moniker"],
    }
    out = json.loads(_enrich_error(err, schema))
    assert out["retry"] is False
    assert out["error_type"] == "UndefinedColumn"
    assert "column n.voting_power does not exist" in out["error"]
    assert out["available_tables"] == schema
    # Hint must tell the LLM NOT to retry the same query path
    assert "do not retry" in out["hint"].lower() or "skip" in out["hint"].lower()


def test_enrich_undefined_table_attaches_schema_and_retry_false():
    err = pg_exc.UndefinedTableError('relation "proposal_votes" does not exist')
    schema = {
        "proposals": ["id", "title", "status"],
        "node_votes": ["id", "node_id", "proposal_id", "vote"],
    }
    out = json.loads(_enrich_error(err, schema))
    assert out["retry"] is False
    assert out["error_type"] == "UndefinedTable"
    assert "proposal_votes" in out["error"]
    assert out["available_tables"] == schema
    # The actually-existing table that the LLM probably wanted
    assert "node_votes" in out["available_tables"]


def test_enrich_other_postgres_error_falls_through():
    """Non-schema errors (timeout, syntax, etc.) return plain error JSON
    without the schema dump — schema is only attached when it would help."""
    err = pg_exc.SyntaxOrAccessError("syntax error at or near \"FORM\"")
    schema = {"nodes": ["id"]}
    out = json.loads(_enrich_error(err, schema))
    assert out["retry"] is False  # we never silently encourage retry
    assert "available_tables" not in out
    assert "FORM" in out["error"]


# --- smart error handling for query_validatorinfo at the I/O boundary -------


async def test_query_validatorinfo_returns_empty_array_on_no_rows(monkeypatch):
    """Empty result is not an error — the LLM should see `[]` and decide
    to narrow the claim or pivot. No `retry: false` flag should appear:
    the query *succeeded*, there's just nothing to report."""
    from src.ai import tools

    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")

    class _FakeConn:
        async def execute(self, _): return None
        async def fetch(self, _): return []
        async def close(self): return None

    async def fake_connect(*_, **__):
        return _FakeConn()

    monkeypatch.setattr("asyncpg.connect", fake_connect)
    out = await tools.query_validatorinfo("SELECT 1")
    parsed = json.loads(out)
    assert parsed == []


async def test_query_validatorinfo_retries_once_on_timeout(monkeypatch):
    """The first timeout retries with a larger budget. A second timeout
    gives up — but the response carries `retry: false` so the LLM does
    not re-issue the same SQL itself."""
    from src.ai import tools

    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    calls = {"fetch": 0}

    class _FakeConn:
        async def execute(self, _): return None

        async def fetch(self, sql):
            calls["fetch"] += 1
            if calls["fetch"] == 1:
                raise asyncio.TimeoutError("first call slow")
            return [{"answer": 42}]

        async def close(self): return None

    async def fake_connect(*_, **__):
        return _FakeConn()

    import asyncio
    monkeypatch.setattr("asyncpg.connect", fake_connect)
    out = await tools.query_validatorinfo("SELECT answer")
    parsed = json.loads(out)
    # Second attempt succeeded
    assert parsed == [{"answer": 42}]
    assert calls["fetch"] == 2


async def test_query_validatorinfo_two_timeouts_give_up_no_retry_hint(monkeypatch):
    from src.ai import tools

    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    calls = {"fetch": 0}

    class _FakeConn:
        async def execute(self, _): return None

        async def fetch(self, _):
            calls["fetch"] += 1
            raise asyncio.TimeoutError("still slow")

        async def close(self): return None

    async def fake_connect(*_, **__):
        return _FakeConn()

    import asyncio
    monkeypatch.setattr("asyncpg.connect", fake_connect)
    out = await tools.query_validatorinfo("SELECT 1")
    parsed = json.loads(out)
    assert calls["fetch"] == 2  # one retry, no more
    assert parsed.get("retry") is False
    assert parsed.get("error_type") == "Timeout"


async def test_query_validatorinfo_connect_failure_skips_no_retry(monkeypatch):
    """If the DB is unreachable, the model cannot fix it. Return a non-retry
    error so it pivots to search_rag or skips the claim."""
    from src.ai import tools

    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")

    async def fake_connect(*_, **__):
        raise ConnectionRefusedError("db down")

    monkeypatch.setattr("asyncpg.connect", fake_connect)
    out = await tools.query_validatorinfo("SELECT 1")
    parsed = json.loads(out)
    assert parsed.get("retry") is False
    assert "db down" in parsed.get("error", "") or "Connect" in parsed.get("error_type", "")
