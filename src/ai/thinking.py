"""Map Aida's `effort` strings (carried over from the Claude config) to a
Gemini `ThinkingConfig`. Single isolated seam: if a model rejects the budget
form, switch to `thinking_level` here without touching callers.
"""

from __future__ import annotations

import logging
from typing import Literal

from google.genai import types

log = logging.getLogger(__name__)

Effort = Literal["off", "min", "low", "medium", "high"]

# token budget for the thinking phase; 0 disables thinking.
_BUDGET = {"off": 0, "min": 0, "low": 1024, "medium": 4096, "high": 16384}
_DEFAULT = _BUDGET["medium"]


def thinking_config(effort: str) -> types.ThinkingConfig:
    if effort not in _BUDGET:
        log.warning("unknown effort %r; falling back to medium", effort)
    return types.ThinkingConfig(thinking_budget=_BUDGET.get(effort, _DEFAULT))
