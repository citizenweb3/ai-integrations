"""Load the agent system instruction.

Aida's persona/gates/output-schema live in `prompts/system.md` and are passed to
the ADK Agent as `instruction` via `agents._static_instruction` so ADK does not
treat literal `{...}` (JSON schema examples) as state-template placeholders.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_INSTRUCTION_PATH = Path(__file__).resolve().parents[2] / "prompts" / "system.md"


@lru_cache(maxsize=1)
def load_instruction() -> str:
    text = _INSTRUCTION_PATH.read_text(encoding="utf-8")
    if not text.strip():
        # An empty instruction would ship an Aida with no persona/gates/schema.
        raise ValueError(f"instruction file is empty: {_INSTRUCTION_PATH}")
    return text
