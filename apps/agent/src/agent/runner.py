"""ADK Runner wrapper that emits transport-friendly event dicts.

Each yielded dict is `{event_type, payload}` and is what the FastAPI layer
serialises to NDJSON. The TS side uses the same shape for `agent_run_events`
rows (see `recordAgentRunEvent`).
"""

from __future__ import annotations

import uuid
from typing import Any, AsyncIterator

from google.adk.runners import InMemoryRunner
from google.genai import types

from .agents import build_agent

_APP_NAME = "bizdev-agent"


async def stream_stage(
    stage: str, prompt: str, *, user_id: str | None = None
) -> AsyncIterator[dict[str, Any]]:
    agent = build_agent(stage)
    runner = InMemoryRunner(agent=agent, app_name=_APP_NAME)

    actor_id = user_id or "system"
    session_id = str(uuid.uuid4())
    await runner.session_service.create_session(
        app_name=_APP_NAME, user_id=actor_id, session_id=session_id
    )

    yield {"event_type": "run_started", "payload": {"stage": stage, "session_id": session_id}}

    content = types.Content(role="user", parts=[types.Part(text=prompt)])

    final_text: str | None = None
    try:
        async for event in runner.run_async(
            user_id=actor_id, session_id=session_id, new_message=content
        ):
            if event.is_final_response() and event.content and event.content.parts:
                # parts may include tool-call/function-response items with .text=None;
                # join all text parts so we don't silently drop the response.
                joined = "".join(part.text or "" for part in event.content.parts)
                if joined:
                    final_text = joined
                    yield {"event_type": "final_response", "payload": {"text": joined}}
                continue

            if event.content and event.content.parts:
                chunk = "".join(part.text or "" for part in event.content.parts)
                if chunk:
                    yield {"event_type": "model_chunk", "payload": {"text": chunk}}
    except Exception as exc:  # surface as terminal event; main.py marks failed
        yield {
            "event_type": "run_failed",
            "payload": {"error": str(exc), "error_type": exc.__class__.__name__},
        }
        return

    if final_text is None:
        yield {
            "event_type": "run_failed",
            "payload": {"error": "agent emitted no text in final response"},
        }
        return

    yield {"event_type": "run_succeeded", "payload": {"final_text": final_text}}
