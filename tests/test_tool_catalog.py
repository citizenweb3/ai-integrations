"""Tests for the tool catalog loader (defense layer L1).

The catalog is a hybrid: hand-written semantic patterns live in a static
yaml file; live `information_schema` overlays the actual table/column
list at startup. The merged catalog is rendered as a markdown section
appended to the system prompt so the LLM sees real schema data without
prompt drift over time.
"""
import textwrap

import pytest

from src.ai.tool_catalog import (
    load_static_catalog,
    merge_schema_overlay,
    render_markdown,
)


def _sample_static() -> dict:
    """Minimal static catalog used as a fixture in several tests."""
    return {
        "tools": {
            "query_validatorinfo": {
                "summary": "Read-only SELECT against ValidatorInfo on-chain DB.",
                "when_to_use": [
                    "validator commission, jailed status, uptime",
                    "active proposals, APR, delegators count",
                ],
                "tables_overlay_target": True,
                "patterns": [
                    {
                        "name": "latest APR for chain",
                        "sql": "SELECT a.value FROM aprs a JOIN chains c ON c.id=a.chain_id WHERE c.name='<chain>' ORDER BY a.created_at DESC LIMIT 1",
                    },
                ],
            },
            "search_rag": {
                "summary": "Vector search over 188+ CW3 podcast episodes.",
                "returns": ["quote", "speakerName", "speakerRole (HOST|GUEST)", "episodeTitle", "episodeUrl"],
                "tables_overlay_target": False,
            },
            "web_research": {
                "summary": "Recent news / post-snapshot state from the open web.",
                "tables_overlay_target": False,
            },
        },
    }


def test_load_static_catalog_parses_yaml(tmp_path):
    yaml_text = textwrap.dedent("""\
        tools:
          query_validatorinfo:
            summary: read-only SQL
            tables_overlay_target: true
          search_rag:
            summary: podcast vector search
            tables_overlay_target: false
        """)
    f = tmp_path / "tools_catalog.yaml"
    f.write_text(yaml_text)
    cat = load_static_catalog(str(f))
    assert "query_validatorinfo" in cat["tools"]
    assert cat["tools"]["query_validatorinfo"]["tables_overlay_target"] is True
    assert cat["tools"]["search_rag"]["tables_overlay_target"] is False


def test_merge_schema_overlay_populates_only_target_tools():
    static = _sample_static()
    overlay = {
        "chains": ["id", "name", "ecosystem"],
        "nodes": ["id", "moniker", "rate", "jailed"],
        "_prisma_migrations": ["id"],  # noise table — must be excluded
    }
    merged = merge_schema_overlay(static, overlay, allowlist={"chains", "nodes"})
    qv = merged["tools"]["query_validatorinfo"]
    assert qv["tables"] == {
        "chains": ["id", "name", "ecosystem"],
        "nodes": ["id", "moniker", "rate", "jailed"],
    }
    # search_rag has tables_overlay_target: false — schema must NOT be attached
    assert "tables" not in merged["tools"]["search_rag"]


def test_merge_schema_overlay_graceful_when_overlay_empty():
    """DB unreachable on startup → loader returns empty overlay; the static
    catalog must still render so the agent keeps working in degraded mode."""
    static = _sample_static()
    merged = merge_schema_overlay(static, overlay={}, allowlist={"chains", "nodes"})
    qv = merged["tools"]["query_validatorinfo"]
    # Empty tables dict, not missing key — the rendered section can show
    # "schema unavailable" rather than raising
    assert qv["tables"] == {}


def test_render_markdown_emits_section_header_and_per_tool_blocks():
    static = _sample_static()
    overlay = {"chains": ["id", "name"], "nodes": ["id", "moniker", "rate"]}
    merged = merge_schema_overlay(static, overlay, allowlist={"chains", "nodes"})
    md = render_markdown(merged)
    # Section header
    assert "## 12. Tool Catalog" in md
    # Per-tool sub-headers
    assert "### query_validatorinfo" in md
    assert "### search_rag" in md
    assert "### web_research" in md
    # Real columns surfaced for the LLM
    assert "chains" in md
    assert "moniker" in md
    # Pattern SQL example carried through
    assert "SELECT a.value FROM aprs" in md
    # search_rag schema fields surfaced
    assert "speakerRole" in md


def test_render_markdown_marks_schema_unavailable_when_overlay_empty():
    static = _sample_static()
    merged = merge_schema_overlay(static, overlay={}, allowlist={"chains", "nodes"})
    md = render_markdown(merged)
    # Degraded message must be present, not a bare empty section
    assert "schema unavailable" in md.lower() or "no schema loaded" in md.lower()


def test_render_markdown_includes_do_not_retry_rule():
    """The catalog header must remind the LLM that schema is fixed and
    retries on UndefinedColumn/UndefinedTable are wasteful. This is the
    text counterpart to the structural AFC cap (L2)."""
    static = _sample_static()
    merged = merge_schema_overlay(static, overlay={"chains": ["id"]}, allowlist={"chains"})
    md = render_markdown(merged)
    assert "do not retry" in md.lower() or "no retry" in md.lower()


def test_responder_appends_catalog_to_instruction():
    """Responder accepts an optional `catalog_section` and appends it to the
    base instruction it hands to ADK agents. This lets the LLM see the
    catalog inside the system prompt without modifying system.md on disk."""
    from src.ai.responder import Responder

    base_config = {
        "gemini": {
            "model_router": "gemini-2.5-flash-lite",
            "model_reactive": "gemini-3.5-flash",
            "model_reply": "gemini-3.1-pro-preview",
            "model_verification": "gemini-3.5-flash",
            "effort_reactive": "low",
            "effort_reply": "high",
            "effort_verification": "high",
            "timeout_seconds": 120,
            "max_concurrent": 1,
            "degraded_pause_minutes": 15,
        },
    }
    catalog = "\n## 12. Tool Catalog\n\nAuthoritative ref.\n"
    r = Responder(base_config, catalog_section=catalog)
    # The combined instruction the responder feeds into agents must include
    # both the base persona file and the catalog block we passed in.
    assert "Aida" in r._instruction
    assert "## 12. Tool Catalog" in r._instruction
    assert "Authoritative ref." in r._instruction
