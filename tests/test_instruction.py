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


def test_instruction_documents_source_disclosure_consent_flow():
    """Guard against drift: the prompt must keep the multi-turn DM consent
    flow rules in place. We had a regression where Aida auto-flipped
    `dm_request: true` on identity / source questions, and a follow-up
    one where she added a soft-offer to the FIRST answer instead of
    waiting for a source-attribution follow-up. See
    .tasks/2026-05-29-aida-source-consent-flow.md."""
    I.load_instruction.cache_clear()
    s = I.load_instruction()
    s_lower = s.lower()
    # The flow must be documented as multi-turn.
    assert "two-turn" in s_lower or "two-step" in s_lower
    # NEVER list must call out unsolicited DM as a banned pattern.
    assert "unsolicited dm" in s_lower
    # The §11 trigger set MUST exclude identity-style questions; the
    # prompt should warn against treating them as link asks.
    assert "what is the podcast" in s_lower or "что за подкаст" in s_lower
    assert "where's the data from" in s_lower or "откуда инфа" in s_lower
    # First-turn rule: NO soft-offer on the initial topic answer.
    # This is the regression that triggered the follow-up fix.
    assert "first-turn rule" in s_lower
    # Soft-offer must be tied to the follow-up turn, not the first answer.
    assert "follow-up" in s_lower and "soft-offer" in s_lower
    # Brand-preserve rule for the second turn: the cite-mode "never
    # name the podcast" rule must NOT apply to source-disclosure
    # follow-ups. Phase 2 verification was observed stripping the
    # brand and producing "I got them from a podcast" instead of
    # "Both points are from the CitizenWeb3 podcast..." — guard
    # against the regression with explicit text in both prompts.
    assert "requires naming the\n    citizenweb3 podcast" in s_lower or "requires naming the citizenweb3 podcast" in s_lower
    I.load_instruction.cache_clear()


def test_verification_prompt_has_brand_preserve_rule():
    """Phase 2 verification was observed stripping the CW3 brand from a
    cite-mode follow-up draft and emitting "I got them from a podcast"
    in the group. The verification prompt must explicitly forbid that.
    See .tasks/2026-05-29-aida-source-consent-flow.md Issue #3."""
    from pathlib import Path
    path = Path(__file__).resolve().parents[1] / "prompts" / "responder_verification.md"
    s = path.read_text(encoding="utf-8").lower()
    assert "brand-preserve rule" in s
    assert "do not strip" in s
    # The three brand names whose follow-up disclosure the rule covers.
    assert "citizenweb3 podcast" in s
    assert "validatorinfo" in s
    assert "web3 society" in s
