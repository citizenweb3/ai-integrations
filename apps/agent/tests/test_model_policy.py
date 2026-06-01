"""Tests for resolve_model_chain — the stage -> model failover chain.

model_policy has no google-adk import, so these run without the ADK runtime.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

_SRC = Path(__file__).resolve().parents[1] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from agent import model_policy  # noqa: E402


# Env keys the chain logic reads, cleared before every test for isolation.
_RELEVANT_ENV = (
    "AGENT_DRAFT_EMAIL_MODEL",
    "AGENT_DRAFT_MODEL",
    "AGENT_DRAFT_EMAIL_MODEL_FALLBACK",
    "AGENT_DEFAULT_MODEL",
    "AGENT_DEFAULT_MODEL_FALLBACK",
)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in _RELEVANT_ENV:
        monkeypatch.delenv(key, raising=False)


def test_no_fallback_yields_single_element_chain(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_DRAFT_EMAIL_MODEL", "gemini-3.1-pro-preview")
    assert model_policy.resolve_model_chain("draft_email") == ["gemini-3.1-pro-preview"]


def test_stage_fallback_appends_in_order(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_DRAFT_EMAIL_MODEL", "gemini-3.1-pro-preview")
    monkeypatch.setenv("AGENT_DRAFT_EMAIL_MODEL_FALLBACK", "gemini-3.5-flash")
    assert model_policy.resolve_model_chain("draft_email") == [
        "gemini-3.1-pro-preview",
        "gemini-3.5-flash",
    ]


def test_multi_step_fallback_chain(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_DRAFT_EMAIL_MODEL", "gemini-3.1-pro-preview")
    monkeypatch.setenv(
        "AGENT_DRAFT_EMAIL_MODEL_FALLBACK", "gemini-2.5-pro, gemini-3.5-flash"
    )
    assert model_policy.resolve_model_chain("draft_email") == [
        "gemini-3.1-pro-preview",
        "gemini-2.5-pro",
        "gemini-3.5-flash",
    ]


def test_fallback_equal_to_primary_is_deduped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_DRAFT_EMAIL_MODEL", "gemini-3.5-flash")
    monkeypatch.setenv("AGENT_DRAFT_EMAIL_MODEL_FALLBACK", "gemini-3.5-flash")
    assert model_policy.resolve_model_chain("draft_email") == ["gemini-3.5-flash"]


def test_global_default_fallback_used_when_stage_fallback_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGENT_DRAFT_EMAIL_MODEL", "gemini-3.1-pro-preview")
    monkeypatch.setenv("AGENT_DEFAULT_MODEL_FALLBACK", "gemini-3.5-flash")
    assert model_policy.resolve_model_chain("draft_email") == [
        "gemini-3.1-pro-preview",
        "gemini-3.5-flash",
    ]


def test_stage_fallback_takes_precedence_over_global(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGENT_DRAFT_EMAIL_MODEL", "gemini-3.1-pro-preview")
    monkeypatch.setenv("AGENT_DRAFT_EMAIL_MODEL_FALLBACK", "gemini-2.5-pro")
    monkeypatch.setenv("AGENT_DEFAULT_MODEL_FALLBACK", "gemini-3.5-flash")
    # Stage-specific fallback wins; global is not appended.
    assert model_policy.resolve_model_chain("draft_email") == [
        "gemini-3.1-pro-preview",
        "gemini-2.5-pro",
    ]


def test_blank_and_whitespace_entries_are_dropped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGENT_DRAFT_EMAIL_MODEL", "gemini-3.1-pro-preview")
    monkeypatch.setenv(
        "AGENT_DRAFT_EMAIL_MODEL_FALLBACK", " gemini-2.5-pro , , gemini-3.5-flash "
    )
    assert model_policy.resolve_model_chain("draft_email") == [
        "gemini-3.1-pro-preview",
        "gemini-2.5-pro",
        "gemini-3.5-flash",
    ]
