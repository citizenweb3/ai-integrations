"""Map Aida's `effort` strings (carried over from the Claude config) to a
Gemini `ThinkingConfig`. Single isolated seam: if a model rejects the budget
form, switch to `thinking_level` here without touching callers.
"""

from __future__ import annotations

from google.genai import types

# token budget for the thinking phase; 0 disables thinking.
_BUDGET = {"off": 0, "min": 0, "low": 1024, "medium": 4096, "high": 16384}
_DEFAULT = _BUDGET["medium"]


def thinking_config(effort: str) -> types.ThinkingConfig:
    return types.ThinkingConfig(thinking_budget=_BUDGET.get(effort, _DEFAULT))
