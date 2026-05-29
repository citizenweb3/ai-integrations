import pytest
from google.genai import types

from src.ai import responder as R
from src.ai.responder import Responder, alert_for_error


@pytest.mark.parametrize("error,expected", [
    (None, (False, "")),
    ("", (False, "")),
    ("auth_error", (True, "CRITICAL")),
    ("auth_locked", (True, "CRITICAL")),
    ("config:ClientError", (True, "CRITICAL")),
    ("degraded_mode_entered", (True, "WARNING")),
    ("rate_limit", (True, "WARNING")),
    ("consecutive_failure", (False, "")),
    ("transient:ClientError", (False, "")),
    ("timeout (120s)", (False, "")),
])
def test_alert_for_error(error, expected):
    assert alert_for_error(error) == expected

_CFG = {"gemini": {
    "model_reactive": "gemini-3.5-flash", "effort_reactive": "low",
    "model_reply": "gemini-3.1-pro-preview", "effort_reply": "high",
    "model_verification": "gemini-3.5-flash", "effort_verification": "high",
    "timeout_seconds": 120, "max_concurrent": 3, "degraded_pause_minutes": 15,
}}

_FINAL_JSON = ('{"action":"respond","text":"hi","confidence":0.95,'
               '"reason":"ok","dm_request":false,"dm_text":""}')


class _FakeEvent:
    def __init__(self, parts, final=False):
        self.content = types.Content(role="model", parts=parts)
        self._final = final

    def is_final_response(self):
        return self._final


def _events_with_tool_and_final():
    return [
        _FakeEvent([types.Part(function_call=types.FunctionCall(name="search_rag", args={"query": "x"}))]),
        _FakeEvent([types.Part(function_response=types.FunctionResponse(name="search_rag", response={"r": "ok"}))]),
        _FakeEvent([types.Part(text=_FINAL_JSON)], final=True),
    ]


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    async def _instant(_seconds):
        return None
    monkeypatch.setattr(R.asyncio, "sleep", _instant)


def _patch_stream(resp, events):
    async def fake_stream(agent, prompt):
        for e in events:
            yield e
    resp._stream_events = fake_stream


def test_exposes_model_names_for_pipeline():
    # response_pipeline.py reads these for the audit `model_name` on the send path.
    resp = Responder(_CFG)
    assert resp._model_reactive == "gemini-3.5-flash"
    assert resp._model_reply == "gemini-3.1-pro-preview"
    assert resp._model_verification == "gemini-3.5-flash"
    assert resp._model == resp._model_reactive


def test_no_role_forces_tool_call():
    """All roles use AUTO function-calling. `mode="ANY"` on verification was
    removed after smoke run #3 — see .tasks/2026-05-28-aida-tool-retry-loop.md.
    `ANY` required a function call on every response, so the model could
    not emit final JSON once data was gathered and looped on dummy SQL.
    The pipeline's Phase-2 hard gate (`if not tool_calls2: skip`) is the
    sole enforcer of ≥1 tool call in verification."""
    resp = Responder(_CFG)
    for role in ("reactive", "reply", "verification"):
        cfg = resp._agents[role].generate_content_config
        assert cfg.tool_config is None, f"role={role} must not pin tool_config"


async def test_generate_returns_parsed_and_tool_calls():
    resp = Responder(_CFG)
    _patch_stream(resp, _events_with_tool_and_final())
    parsed, calls = await resp.generate("p", is_verification=True)
    assert parsed["action"] == "respond"
    assert parsed["confidence"] == 0.95
    assert len(calls) == 1
    assert calls[0]["tool_name"] == "search_rag"


async def test_generate_no_final_text_returns_none():
    resp = Responder(_CFG)
    _patch_stream(resp, [_FakeEvent([types.Part(text="")], final=True)])
    parsed, calls = await resp.generate("p")
    assert parsed is None
    # generate() runs 2 attempts then reports the terminal failure state
    assert resp.last_error == "consecutive_failure"


async def test_generate_short_circuits_when_auth_locked():
    resp = Responder(_CFG)
    resp.health.mark_auth_failure("bad")
    parsed, calls = await resp.generate("p")
    assert parsed is None and calls == []
    assert resp.last_error == "auth_locked"


def test_init_rejects_api_key(monkeypatch):
    # the Vertex-only guard must run at construction
    monkeypatch.setenv("GOOGLE_API_KEY", "leak")
    with pytest.raises(RuntimeError, match="GOOGLE_API_KEY"):
        Responder(_CFG)


async def test_generate_auth_error_locks_health():
    from google.genai import errors as gerrors
    resp = Responder(_CFG)

    async def boom(agent, prompt):
        raise gerrors.ClientError(403, {"error": {"status": "PERMISSION_DENIED", "code": 403}})
        yield  # pragma: no cover

    resp._stream_events = boom
    parsed, _ = await resp.generate("p")
    assert parsed is None
    assert resp.health.auth_locked is True
    # the cause must be captured so the operator alert carries detail
    assert resp.last_error_detail


async def test_generate_config_error_surfaces_and_does_not_degrade():
    from google.genai import errors as gerrors
    resp = Responder(_CFG)

    async def boom(agent, prompt):
        raise gerrors.ClientError(400, {"error": {"status": "INVALID_ARGUMENT", "code": 400}})
        yield  # pragma: no cover

    resp._stream_events = boom
    parsed, _ = await resp.generate("p")
    assert parsed is None
    # config = deploy bug: surfaced distinctly (-> CRITICAL alert), not buried as
    # consecutive_failure, and it must not count toward the degrade threshold.
    assert resp.last_error.startswith("config")
    assert resp.health.consecutive_failures == 0
