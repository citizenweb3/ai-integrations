"""Tests for the retry + failover loop in stream_stage.

runner.py imports google.adk + google.genai at module load, which are not
installed in the test env (they live only in the agent container). We install
lightweight stand-ins in sys.modules BEFORE importing runner, then drive the
loop with a fake InMemoryRunner whose run_async raises/yields on a script.
"""

from __future__ import annotations

import sys
import types as pytypes
from pathlib import Path

import pytest

_SRC = Path(__file__).resolve().parents[1] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))


# ---- stub google.adk / google.genai before importing runner ---------------

def _install_google_stubs() -> None:
    if "google.adk.runners" in sys.modules:
        return

    google = pytypes.ModuleType("google")
    adk = pytypes.ModuleType("google.adk")
    adk_runners = pytypes.ModuleType("google.adk.runners")
    adk_tools = pytypes.ModuleType("google.adk.tools")
    adk_tools_base = pytypes.ModuleType("google.adk.tools.base_tool")
    genai = pytypes.ModuleType("google.genai")
    genai_types = pytypes.ModuleType("google.genai.types")

    class _Agent:  # google.adk.Agent
        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs

    class _InMemoryRunner:  # replaced per-test via monkeypatch
        def __init__(self, *args: object, **kwargs: object) -> None:
            raise NotImplementedError

    class _BaseTool:  # google.adk.tools.base_tool.BaseTool
        name = "stub"

    def _google_search() -> None:  # google.adk.tools.google_search
        return None

    class _Content:
        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs

    class _Part:
        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs

    adk.Agent = _Agent
    adk_runners.InMemoryRunner = _InMemoryRunner
    adk_tools.google_search = _google_search
    adk_tools_base.BaseTool = _BaseTool
    genai.types = genai_types
    genai_types.Content = _Content
    genai_types.Part = _Part

    google.adk = adk
    sys.modules["google"] = google
    sys.modules["google.adk"] = adk
    sys.modules["google.adk.runners"] = adk_runners
    sys.modules["google.adk.tools"] = adk_tools
    sys.modules["google.adk.tools.base_tool"] = adk_tools_base
    sys.modules["google.genai"] = genai
    sys.modules["google.genai.types"] = genai_types


_install_google_stubs()

from agent import runner as runner_mod  # noqa: E402


# ---- fakes ----------------------------------------------------------------

class _ResourceExhausted(Exception):
    """Stand-in whose name matches the 429 detector."""


class _Event:
    """Minimal ADK event: a final response carrying one text part."""

    def __init__(self, text: str) -> None:
        self._text = text
        self.content = pytypes.SimpleNamespace(
            parts=[pytypes.SimpleNamespace(text=text)]
        )
        self.citation_metadata = None

    def is_final_response(self) -> bool:
        return True


class _FakeSessionService:
    async def create_session(self, **kwargs: object) -> None:
        return None


class _FakeRunner:
    """Scripted runner. `script` is one entry per build: either an Exception
    instance (raised) or a final text string (yielded as a final response)."""

    script: list[object] = []
    builds: list[str] = []
    _idx = 0

    def __init__(self, *, agent: object, app_name: str) -> None:
        # Agent stub stores its model under kwargs; record it for assertions.
        model = getattr(agent, "kwargs", {}).get("model")
        type(self).builds.append(model)
        self._behavior = type(self).script[type(self)._idx]
        type(self)._idx += 1
        self.session_service = _FakeSessionService()

    async def run_async(self, **kwargs: object):
        if isinstance(self._behavior, BaseException):
            raise self._behavior
        yield _Event(self._behavior)


@pytest.fixture(autouse=True)
def _wire(monkeypatch: pytest.MonkeyPatch) -> None:
    # No real backoff sleeps.
    async def _no_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(runner_mod.asyncio, "sleep", _no_sleep)
    # build_agent returns a stub carrying the model so _FakeRunner can read it.
    monkeypatch.setattr(
        runner_mod,
        "build_agent",
        lambda stage, model=None: pytypes.SimpleNamespace(kwargs={"model": model}),
    )
    monkeypatch.setattr(runner_mod, "InMemoryRunner", _FakeRunner)
    monkeypatch.setattr(
        runner_mod, "resolve_model_chain", lambda stage: ["primary-model", "fallback-model"]
    )
    monkeypatch.setenv("AGENT_RETRY_MAX_ATTEMPTS", "3")
    # reset scripted runner state
    _FakeRunner.script = []
    _FakeRunner.builds = []
    _FakeRunner._idx = 0


async def _collect(stage: str = "draft_email", prompt: str = "p") -> list[dict]:
    return [event async for event in runner_mod.stream_stage(stage, prompt)]


def _types(events: list[dict]) -> list[str]:
    return [e["event_type"] for e in events]


async def test_retry_same_model_then_success() -> None:
    # First attempt 429, second attempt on the SAME model succeeds.
    _FakeRunner.script = [_ResourceExhausted("429 RESOURCE_EXHAUSTED"), "OK BODY"]
    events = await _collect()

    assert "run_succeeded" in _types(events)
    succeeded = next(e for e in events if e["event_type"] == "run_succeeded")
    assert succeeded["payload"]["model"] == "primary-model"
    assert succeeded["payload"]["final_text"] == "OK BODY"
    # No failover happened — both builds were the primary.
    assert _FakeRunner.builds == ["primary-model", "primary-model"]
    assert "model_failover" not in _types(events)


async def test_failover_to_next_model() -> None:
    # Primary exhausts all 3 attempts on 429, fallback succeeds.
    _FakeRunner.script = [
        _ResourceExhausted("429"),
        _ResourceExhausted("429"),
        _ResourceExhausted("429"),
        "FALLBACK BODY",
    ]
    events = await _collect()

    assert "model_failover" in _types(events)
    failover = next(e for e in events if e["event_type"] == "model_failover")
    assert failover["payload"]["from_model"] == "primary-model"
    assert failover["payload"]["to_model"] == "fallback-model"

    succeeded = next(e for e in events if e["event_type"] == "run_succeeded")
    assert succeeded["payload"]["model"] == "fallback-model"
    assert succeeded["payload"]["final_text"] == "FALLBACK BODY"


async def test_whole_chain_exhausted_fails() -> None:
    # Every attempt on every model returns 429 (2 models x 3 attempts).
    _FakeRunner.script = [_ResourceExhausted("429")] * 6
    events = await _collect()

    assert "run_succeeded" not in _types(events)
    failed = next(e for e in events if e["event_type"] == "run_failed")
    assert "all models exhausted" in failed["payload"]["error"]
    assert failed["payload"]["error_type"] == "ResourceExhausted"


async def test_non_429_fails_immediately_without_retry() -> None:
    _FakeRunner.script = [ValueError("schema blew up"), "NEVER REACHED"]
    events = await _collect()

    failed = next(e for e in events if e["event_type"] == "run_failed")
    assert failed["payload"]["error_type"] == "ValueError"
    # Only one build — no retry, no failover.
    assert _FakeRunner.builds == ["primary-model"]
    assert "model_failover" not in _types(events)
    assert "run_succeeded" not in _types(events)
