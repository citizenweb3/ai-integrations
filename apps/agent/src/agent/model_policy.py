"""Stage -> model id resolver. Mirrors the TS ModelPolicyResolver.

Reads `AGENT_<STAGE>_MODEL` env vars (e.g. `AGENT_RESEARCH_MODEL`) and falls
back to `AGENT_DEFAULT_MODEL`, then to a hard-coded default. Keeping it env-
backed lets ops swap models without code changes during MVP.
"""

from __future__ import annotations

import os

_HARD_DEFAULT = "gemini-3-flash-preview"


def resolve_model(stage: str) -> str:
    env_key = f"AGENT_{stage.upper()}_MODEL"
    return (
        os.environ.get(env_key)
        or os.environ.get("AGENT_DEFAULT_MODEL")
        or _HARD_DEFAULT
    )
