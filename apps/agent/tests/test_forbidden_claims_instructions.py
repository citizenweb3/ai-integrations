"""Regression tests for the T-026BW forbidden-claims rules baked into the agent
instruction constants.

The DB tests prove the prompt BUILDERS render the `<forbidden_claims>` block;
nothing else proves the agent INSTRUCTIONS actually tell the model to honour it.
Without these the Python rules could be deleted and every DB test would stay
green. We assert on the constant strings directly, with substring checks on the
load-bearing tokens (not exact wording).

`agent.agents` imports `google.adk` and `agent.assist` imports `google.genai`
at module load. Those runtime deps are not needed to read the instruction
strings, so we stub the missing top-level packages in `sys.modules` before
import — both modules use `from __future__ import annotations`, so the only
import-time requirement is that the `from google...` statements resolve.
"""

from __future__ import annotations

import sys
import types as _pytypes
from pathlib import Path

_SRC = Path(__file__).resolve().parents[1] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))


def _ensure_stub(name: str, attrs: dict[str, object] | None = None) -> _pytypes.ModuleType:
    """Register a stub module under `name` if the real package is absent."""
    if name in sys.modules:
        module = sys.modules[name]
    else:
        module = _pytypes.ModuleType(name)
        sys.modules[name] = module
    for attr, value in (attrs or {}).items():
        if not hasattr(module, attr):
            setattr(module, attr, value)
    return module


def _install_google_stubs() -> None:
    # google.adk.Agent / google.adk.tools.google_search / .base_tool.BaseTool
    try:  # real package present (e.g. CI with deps installed) — leave it alone.
        import google.adk  # noqa: F401
        import google.adk.tools  # noqa: F401
        import google.adk.tools.base_tool  # noqa: F401
    except Exception:
        google_pkg = _ensure_stub("google")
        adk = _ensure_stub("google.adk", {"Agent": object})
        setattr(google_pkg, "adk", adk)
        tools = _ensure_stub("google.adk.tools", {"google_search": object()})
        setattr(adk, "tools", tools)
        base_tool = _ensure_stub("google.adk.tools.base_tool", {"BaseTool": object})
        setattr(tools, "base_tool", base_tool)

    # google.genai + google.genai.types
    try:
        import google.genai  # noqa: F401
        import google.genai.types  # noqa: F401
    except Exception:
        google_pkg = _ensure_stub("google")
        genai = _ensure_stub("google.genai", {"Client": object})
        setattr(google_pkg, "genai", genai)
        genai_types = _ensure_stub("google.genai.types", {})
        setattr(genai, "types", genai_types)


_install_google_stubs()

from agent import agents as agents_mod  # noqa: E402
from agent import assist as assist_mod  # noqa: E402


def _lower(text: str) -> str:
    return text.lower()


def test_draft_instruction_has_forbidden_claims_rule_with_absolute_precedence() -> None:
    text = _lower(agents_mod._DRAFT_INSTRUCTION)
    assert "forbidden_claims" in text or "forbidden claim" in text
    assert "precedence" in text
    # cold draft: precedence is over the research snapshot + the About-us /
    # drafting-brief facts.
    assert "snapshot" in text
    assert "about-us" in text or "about us" in text or "drafting brief" in text


def test_revise_instruction_has_forbidden_claims_rule_feedback_cannot_override() -> None:
    text = _lower(agents_mod._REVISE_INSTRUCTION)
    assert "forbidden_claims" in text or "forbidden claim" in text
    assert "precedence" in text
    assert "snapshot" in text
    # revise-specific: operator feedback must not override the forbidden claims.
    assert "operator feedback" in text or "feedback cannot override" in text
    assert "override" in text


def test_warm_instruction_has_forbidden_claims_rule_with_precedence_over_reply_intent() -> None:
    text = _lower(agents_mod._DRAFT_WARM_INSTRUCTION)
    assert "forbidden_claims" in text or "forbidden claim" in text
    assert "precedence" in text
    # warm-specific: precedence is over the replyIntent.
    assert "replyintent" in text or "reply intent" in text
    assert "snapshot" in text


def test_assist_system_instruction_binds_forbidden_claims_in_sample_draft() -> None:
    text = assist_mod._SYSTEM_INSTRUCTION
    lower = _lower(text)
    # The B6 sample-draft section + the optional-field list both reference the
    # forbiddenClaims binding.
    assert "forbiddenclaims" in lower or "forbidden claim" in lower
    # The sample-draft rule binds the sample to the same forbidden-claims
    # restriction the real drafts are under.
    assert "forbiddenclaims" in lower
    assert "claim" in lower and ("never" in lower or "must never" in lower or "restriction" in lower)
    # Robustness guard: the system prompt itself must not embed a concrete
    # forbidden claim as if it were a real assertion. We only check that the
    # known marketing red-flags from the DB tests are absent from the prompt
    # template (the template describes the rule, it does not make the claim).
    for banned in ("guaranteed roi", "cures everything"):
        assert banned not in lower
