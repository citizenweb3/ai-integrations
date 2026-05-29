"""Tool catalog — hybrid static + autogen schema overlay.

The catalog is the L1 defense layer against LLM tool-loop regressions
(see .tasks/2026-05-28-aida-tool-retry-loop.md). The static yaml carries
hand-written semantics (when to use each tool, canonical patterns) that
do not drift. The autogen overlay queries `information_schema` on
startup so the LLM always sees real column names — no guessing.

The rendered markdown is appended to `prompts/system.md` as `§12. Tool
Catalog` when the responder builds its instruction.

If the DB is unreachable on startup the overlay is empty and the
rendered section marks the schema as unavailable — the agent keeps
working in degraded mode (search_rag and web_research still operate).
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

import yaml

log = logging.getLogger(__name__)


def load_static_catalog(path: str) -> dict:
    """Parse the static yaml catalog at `path`."""
    with open(path) as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict) or "tools" not in data:
        raise ValueError(f"tool catalog at {path} must be a mapping with a 'tools' key")
    return data


def merge_schema_overlay(
    static: dict,
    overlay: dict[str, list[str]],
    allowlist: set[str],
) -> dict:
    """Attach `overlay` (table → columns) to tools that opt into a schema view.

    Only tables in `allowlist` are surfaced. Tools whose static entry has
    `tables_overlay_target: True` get a `tables` key populated from the
    filtered overlay; other tools are left alone. The merge is non-mutating.
    """
    filtered = {t: cols for t, cols in overlay.items() if t in allowlist}
    merged = {"tools": {}}
    for name, spec in static.get("tools", {}).items():
        copy = dict(spec)
        if copy.pop("tables_overlay_target", False):
            copy["tables"] = filtered
        merged["tools"][name] = copy
    return merged


async def fetch_schema_overlay(dsn: str) -> dict[str, list[str]]:
    """Connect to Postgres and dump `public.*` columns as {table: [cols]}.

    Best-effort: on any failure returns an empty dict so the loader can
    fall back to the static catalog. Errors are logged, not raised.
    """
    import asyncpg

    try:
        conn = await asyncpg.connect(dsn, timeout=5)
    except Exception as e:  # noqa: BLE001 — degraded mode is acceptable
        log.warning("tool_catalog_db_connect_failed: %s: %s", type(e).__name__, e)
        return {}
    try:
        rows = await conn.fetch(
            """
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
            """
        )
    except Exception as e:  # noqa: BLE001 — degraded mode is acceptable
        log.warning("tool_catalog_schema_dump_failed: %s: %s", type(e).__name__, e)
        return {}
    finally:
        await conn.close()
    schema: dict[str, list[str]] = {}
    for row in rows:
        schema.setdefault(row["table_name"], []).append(row["column_name"])
    return schema


def render_markdown(catalog: dict) -> str:
    """Render the merged catalog as a markdown `## 12. Tool Catalog` section.

    Layout per tool:
        ### <tool name>
        <summary line>
        when_to_use bullets (if any)
        tables block (only when tables overlay populated)
        returns block (for search-style tools)
        patterns block (canonical SQL examples)
    """
    lines: list[str] = []
    lines.append("## 12. Tool Catalog")
    lines.append("")
    lines.append(
        "Authoritative reference for the tools the agent can call. Schema is "
        "fixed: do not retry against guessed columns or tables. If a column "
        "is missing from the catalog, the data is not in ValidatorInfo — "
        "switch tool or narrow the claim."
    )
    lines.append("")

    for name, spec in catalog.get("tools", {}).items():
        lines.append(f"### {name}")
        if summary := spec.get("summary"):
            lines.append(summary)
            lines.append("")

        if when := spec.get("when_to_use"):
            lines.append("When to use:")
            for item in when:
                lines.append(f"- {item}")
            lines.append("")

        if "tables" in spec:
            tables = spec["tables"]
            if not tables:
                lines.append("Tables: _schema unavailable (DB not reachable at startup)._")
            else:
                lines.append("Tables (public schema, fixed):")
                for table, cols in sorted(tables.items()):
                    cols_str = ", ".join(cols)
                    lines.append(f"- `{table}` ({cols_str})")
            lines.append("")

        if returns := spec.get("returns"):
            lines.append("Returns per result:")
            for field in returns:
                lines.append(f"- `{field}`")
            lines.append("")

        if patterns := spec.get("patterns"):
            lines.append("Canonical patterns:")
            for p in patterns:
                lines.append(f"- {p['name']}:")
                lines.append(f"  ```sql")
                lines.append(f"  {p['sql']}")
                lines.append(f"  ```")
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


# --- Convenience builder used by responder/agents at startup -----------------

# Tables we want surfaced in the catalog. Everything else (Prisma migration
# tracking, history tables, podcast vector storage internals) is noise.
DEFAULT_ALLOWLIST: set[str] = {
    "chains",
    "nodes",
    "validators",
    "aprs",
    "proposals",
    "node_votes",
    "chain_validators_history",
    "nodes_consensus_data",
}


async def build_catalog_section(
    static_path: str | None = None,
    dsn: str | None = None,
    allowlist: set[str] | None = None,
) -> str:
    """One-shot helper: load static + fetch overlay + render markdown.

    Returns the rendered `## 12. Tool Catalog` section as a string ready
    to be appended to the system prompt. If `dsn` is empty/None the
    overlay step is skipped (static-only rendering).
    """
    static_path = static_path or str(
        Path(__file__).resolve().parents[2] / "prompts" / "tools_catalog.yaml"
    )
    allowlist = allowlist if allowlist is not None else DEFAULT_ALLOWLIST
    static = load_static_catalog(static_path)
    overlay: dict[str, list[str]] = {}
    if dsn:
        overlay = await fetch_schema_overlay(dsn)
    merged = merge_schema_overlay(static, overlay, allowlist)
    return render_markdown(merged)
