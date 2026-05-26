import pytest
from google.genai import types

from src.ai import responder as R
from src.ai.responder import Responder

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
