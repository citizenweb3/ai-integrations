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
    "research_quality_gate": ("AGENT_RESEARCH_QUALITY_GATE_MODEL",),
    "contact_candidate_discovery": (
        "AGENT_CONTACT_CANDIDATE_DISCOVERY_MODEL",
        "AGENT_RESEARCH_MODEL",
    ),
    "draft_email": ("AGENT_DRAFT_EMAIL_MODEL", "AGENT_DRAFT_MODEL"),
    "draft_warm_email": ("AGENT_DRAFT_WARM_EMAIL_MODEL", "AGENT_DRAFT_WARM_MODEL"),
    "revise_email": ("AGENT_REVISE_EMAIL_MODEL", "AGENT_REVISE_MODEL"),
    "validate_claims": ("AGENT_VALIDATE_CLAIMS_MODEL", "AGENT_VALIDATE_MODEL"),
    "classify_reply": ("AGENT_CLASSIFY_REPLY_MODEL",),
    "campaign_discovery": ("AGENT_CAMPAIGN_DISCOVERY_MODEL",),
    "campaign_scope_assist": ("AGENT_CAMPAIGN_SCOPE_ASSIST_MODEL",),
    # T-026BO: grounded one-shot that reads the operator's site via google_search
    # and returns plain-text facts about us for the drafting brief.
    "campaign_site_study": ("AGENT_CAMPAIGN_SITE_STUDY_MODEL",),
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


def _parse_model_list(raw: str | None) -> list[str]:
    """Split a comma-separated model env value into a clean list."""
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def resolve_model_chain(stage: str) -> list[str]:
    """Ordered model chain for a stage: primary first, then failovers.

    The primary is `resolve_model(stage)`. Failovers come from a
    stage-specific `AGENT_<STAGE>_MODEL_FALLBACK` (comma-separated for a
    multi-step chain), falling back to a global `AGENT_DEFAULT_MODEL_FALLBACK`.
    The primary is de-duplicated out of the failover list and order is
    preserved. A stage with no configured fallback yields a single-element
    chain, so callers behave exactly as before failover existed.
    """
    primary = resolve_model(stage)

    fallback_key = f"AGENT_{stage.upper()}_MODEL_FALLBACK"
    fallbacks = _parse_model_list(os.environ.get(fallback_key))
    if not fallbacks:
        fallbacks = _parse_model_list(os.environ.get("AGENT_DEFAULT_MODEL_FALLBACK"))

    chain = [primary]
    for model in fallbacks:
        if model not in chain:
            chain.append(model)
    return chain
