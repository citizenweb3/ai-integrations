import pytest

from src.ai import instruction as I


def test_load_instruction_returns_text():
    I.load_instruction.cache_clear()
    text = I.load_instruction()
    assert isinstance(text, str) and text.strip()


def test_load_instruction_rejects_empty(monkeypatch, tmp_path):
    empty = tmp_path / "CLAUDE.md"
    empty.write_text("   \n")
    monkeypatch.setattr(I, "_INSTRUCTION_PATH", empty)
    I.load_instruction.cache_clear()
    with pytest.raises(ValueError, match="empty"):
        I.load_instruction()
    I.load_instruction.cache_clear()
