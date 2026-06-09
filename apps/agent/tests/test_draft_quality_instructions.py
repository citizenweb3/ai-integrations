"""Regression tests for the cold-draft QUALITY rules baked into the agent
draft instruction.

The DB tests prove prompt builders render their inputs; nothing else pins the
craft rules the cold-draft model is told to follow. These assert on the constant
string directly, with substring checks on the load-bearing tokens (not exact
wording), so a deleted rule fails loudly. Mirrors
`test_forbidden_claims_instructions.py`: stub the missing google packages so the
instruction strings can be read without the runtime deps.
"""

from __future__ import annotations

import sys
import types as _pytypes
from pathlib import Path

_SRC = Path(__file__).resolve().parents[1] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))


def _ensure_stub(name: str, attrs: dict[str, object] | None = None) -> _pytypes.ModuleType:
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
    try:
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


def _lower(text: str) -> str:
    return text.lower()


def test_draft_open_is_observation_plus_hypothesis_not_bare_praise() -> None:
    # The opener should be a specific observation tied to a hypothesis about the
    # target's goal/need — not bare admiration (which pattern-matches as
    # templated flattery and lowers replies).
    text = _lower(agents_mod._DRAFT_INSTRUCTION)
    assert "observation" in text
    assert "hypothesis" in text


def test_draft_allows_soft_cta_and_a_ps_referral_routing_line() -> None:
    # A soft / interest-based ask is permitted, plus an optional one-line P.S.
    # routing question (who is the right person) as a referral fallback.
    text = _lower(agents_mod._DRAFT_INSTRUCTION)
    assert "interest-based" in text
    assert "p.s." in text
    assert "referral" in text


def test_draft_prefers_a_concrete_proof_point_for_our_value() -> None:
    # Value claims about US should prefer a concrete proof point (a named
    # comparable / real result) over a vague benefit — never fabricated.
    text = _lower(agents_mod._DRAFT_INSTRUCTION)
    assert "proof point" in text
    assert "comparable" in text
