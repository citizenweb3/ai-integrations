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


def _citation_metadata_payload(citation_metadata: Any) -> dict[str, Any] | None:
    raw_citations = getattr(citation_metadata, "citations", None)
    if not raw_citations:
        return None

    citations: list[dict[str, Any]] = []
    for citation in raw_citations:
        uri = getattr(citation, "uri", None)
        if not isinstance(uri, str) or not uri.strip():
            continue

        item: dict[str, Any] = {"uri": uri.strip()}
        title = getattr(citation, "title", None)
        if isinstance(title, str) and title.strip():
            item["title"] = title.strip()

        start_index = getattr(citation, "start_index", None)
        if isinstance(start_index, int) and start_index >= 0:
            item["startIndex"] = start_index

        end_index = getattr(citation, "end_index", None)
        if isinstance(end_index, int) and end_index >= 0:
            item["endIndex"] = end_index

        citations.append(item)
        if len(citations) >= 100:
            break

    return {"citations": citations} if citations else None


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
                    payload: dict[str, Any] = {"text": joined}
                    citation_payload = _citation_metadata_payload(
                        getattr(event, "citation_metadata", None)
                    )
                    if citation_payload:
                        payload.update(citation_payload)
                    yield {"event_type": "final_response", "payload": payload}
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
