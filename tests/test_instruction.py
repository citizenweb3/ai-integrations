import pytest

from src.ai import instruction as I


def test_load_instruction_returns_text():
    I.load_instruction.cache_clear()
    text = I.load_instruction()
    assert isinstance(text, str) and text.strip()


def test_instruction_has_no_cli_tool_refs():
    I.load_instruction.cache_clear()
    s = I.load_instruction()
    # ADK uses named function tools, not CLI scripts invoked via Bash
    assert "python src/tools/" not in s
    assert "query-db.py" not in s
    assert "search-rag.py" not in s
    assert "WebSearch" not in s
    assert "query_validatorinfo" in s
    assert "search_rag" in s
    assert "web_research" in s
    I.load_instruction.cache_clear()


def test_load_instruction_rejects_empty(monkeypatch, tmp_path):
    empty = tmp_path / "CLAUDE.md"
    empty.write_text("   \n")
    monkeypatch.setattr(I, "_INSTRUCTION_PATH", empty)
    I.load_instruction.cache_clear()
    with pytest.raises(ValueError, match="empty"):
        I.load_instruction()
    I.load_instruction.cache_clear()
