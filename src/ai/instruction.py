"""Load the agent system instruction.

CLAUDE.md was auto-loaded by `claude -p` from the working directory. ADK has no
such mechanism, so its content is read here and passed as the ADK `Agent.instruction`.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_INSTRUCTION_PATH = Path(__file__).resolve().parents[2] / "CLAUDE.md"


@lru_cache(maxsize=1)
def load_instruction() -> str:
    return _INSTRUCTION_PATH.read_text(encoding="utf-8")
