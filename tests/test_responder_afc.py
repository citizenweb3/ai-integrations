"""Tests for the per-turn tool-call cap (defense layer L2).

ADK manages its own tool loop in `base_llm_flow._run_one_step_async` and
does NOT delegate to GenAI's automatic function calling, despite the
"AFC is enabled with max remote calls: 10" log line from the genai SDK
(that log is informational and unrelated to the ADK loop — see
google/adk-python issue #4133 confirming `AutomaticFunctionCallingConfig`
is silently ignored when set on the ADK Agent's generate_content_config).

The real structural cap is `RunConfig.max_llm_calls`, passed to
`runner.run_async`. ADK enforces it via `_InvocationCostManager` and
raises `LlmCallsLimitExceededError` once exceeded.
"""
import asyncio
import inspect

from google.adk.agents.run_config import RunConfig

from src.ai.responder import Responder


def _config() -> dict:
    return {
        "gemini": {
            "model_router": "gemini-2.5-flash-lite",
            "model_reactive": "gemini-3.5-flash",
            "model_reply": "gemini-3.1-pro-preview",
            "model_verification": "gemini-3.5-flash",
            "effort_reactive": "low",
            "effort_reply": "high",
            "effort_verification": "high",
            "timeout_seconds": 120,
            "max_concurrent": 1,
            "degraded_pause_minutes": 15,
        },
    }


async def test_stream_events_passes_run_config_with_call_cap(monkeypatch):
    """`_stream_events` must hand the InMemoryRunner a RunConfig with a
    small `max_llm_calls` so ADK's tool loop is structurally bounded —
    independent of what the model or prompt try to do."""
    captured: dict = {}

    class _FakeRunner:
        def __init__(self, agent=None, app_name=None):
            self.session_service = self  # quack: create_session

        async def create_session(self, app_name, user_id, session_id):
            return None

        async def run_async(self, *, user_id, session_id, new_message, run_config=None, **_):
            captured["run_config"] = run_config
            if False:
                yield None  # mark as async generator
            return

    monkeypatch.setattr("src.ai.responder.InMemoryRunner", _FakeRunner)

    r = Responder(_config())
    async for _ in r._stream_events(agent=object(), prompt="hi"):
        pass

    rc = captured.get("run_config")
    assert rc is not None, "RunConfig must be passed to runner.run_async"
    assert isinstance(rc, RunConfig)
    # Tight enough to catch a true cycling regression (which previously
    # ran 50+ tool retries), loose enough not to throttle legitimate
    # thinking + 2-3 tool rounds + sub-agent web_research that shares
    # this invocation-wide budget (adk-python #1167). Normal verification
    # uses ≤ ~8 calls.
    assert rc.max_llm_calls is not None and 20 <= rc.max_llm_calls <= 100, (
        f"max_llm_calls={rc.max_llm_calls} must be in [20, 100]"
    )
