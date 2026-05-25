"""Stage -> model id resolver.

Reads stage-specific `AGENT_*_MODEL` env vars, falls back to
`AGENT_DEFAULT_MODEL`, then to a hard-coded default. A small alias map keeps
older short env names working while the public contract uses exact ADK stage
names such as `AGENT_DRAFT_EMAIL_MODEL`.
"""

from __future__ import annotations

import os

_HARD_DEFAULT = "gemini-3.5-flash"

_STAGE_MODEL_ENV_KEYS: dict[str, tuple[str, ...]] = {
    "research_snapshot": ("AGENT_RESEARCH_SNAPSHOT_MODEL", "AGENT_RESEARCH_MODEL"),
    "research_more": ("AGENT_RESEARCH_MORE_MODEL", "AGENT_RESEARCH_MODEL"),
    "draft_email": ("AGENT_DRAFT_EMAIL_MODEL", "AGENT_DRAFT_MODEL"),
    "draft_warm_email": ("AGENT_DRAFT_WARM_EMAIL_MODEL", "AGENT_DRAFT_WARM_MODEL"),
    "revise_email": ("AGENT_REVISE_EMAIL_MODEL", "AGENT_REVISE_MODEL"),
    "validate_claims": ("AGENT_VALIDATE_CLAIMS_MODEL", "AGENT_VALIDATE_MODEL"),
    "classify_reply": ("AGENT_CLASSIFY_REPLY_MODEL",),
    "campaign_discovery": ("AGENT_CAMPAIGN_DISCOVERY_MODEL",),
}


def resolve_model(stage: str) -> str:
    env_keys = _STAGE_MODEL_ENV_KEYS.get(
        stage,
        (f"AGENT_{stage.upper()}_MODEL",),
    )
    for env_key in env_keys:
        value = os.environ.get(env_key)
        if value:
            return value
    return os.environ.get("AGENT_DEFAULT_MODEL") or _HARD_DEFAULT
