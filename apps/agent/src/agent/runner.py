"""ADK Runner wrapper that emits transport-friendly event dicts.

Each yielded dict is `{event_type, payload}` and is what the FastAPI layer
serialises to NDJSON. The TS side uses the same shape for `agent_run_events`
rows (see `recordAgentRunEvent`).
"""

from __future__ import annotations

import asyncio
import os
import uuid
from typing import Any, AsyncIterator

from google.adk.runners import InMemoryRunner
from google.genai import types

from .agents import build_agent
from .model_policy import resolve_model_chain

_APP_NAME = "bizdev-agent"


def _retry_max_attempts() -> int:
    """Per-model attempts before failing over to the next model in the chain."""
    raw = os.environ.get("AGENT_RETRY_MAX_ATTEMPTS")
    try:
        value = int(raw) if raw else 3
    except ValueError:
        value = 3
    return max(1, value)


def _retry_base_delay_seconds() -> float:
    raw = os.environ.get("AGENT_RETRY_BASE_DELAY_MS")
    try:
        value = float(raw) / 1000.0 if raw else 0.5
    except ValueError:
        value = 0.5
    return max(0.0, value)


def _backoff_seconds(attempt: int) -> float:
    """Exponential backoff with a small deterministic jitter, capped at 8s.

    Jitter is derived from a uuid (Math.random is unavailable in the worker
    harness, but the agent process is a normal Python runtime) — a tiny spread
    so retries from concurrent jobs don't align on the same RPM window.
    """
    base = _retry_base_delay_seconds()
    raw = base * (2 ** attempt)
    jitter = (uuid.uuid4().int % 250) / 1000.0  # 0..0.25s
    return min(raw + jitter, 8.0)


def _is_resource_exhausted(exc: BaseException) -> bool:
    """True when an exception is a Gemini/Vertex 429 RESOURCE_EXHAUSTED.

    ADK wraps Google API errors in a few shapes; match the common type names
    and fall back to scanning the string so a 429 is recognized regardless of
    which layer raised it.
    """
    type_name = exc.__class__.__name__
    if type_name in {"ResourceExhausted", "TooManyRequests"}:
        return True
    status = getattr(exc, "status", None) or getattr(exc, "code", None)
    if status in (429, "RESOURCE_EXHAUSTED"):
        return True
    text = str(exc)
    return "429" in text or "RESOURCE_EXHAUSTED" in text


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


async def _run_once(
    stage: str, model: str, prompt: str, actor_id: str
) -> tuple[list[dict[str, Any]], str]:
    """Run one stage attempt on one model.

    Returns (events, final_text): the events to emit on success (model_chunk*
    + final_response) plus the final response text. Buffers rather than yields
    so a 429 raised mid-run does
    not leak partial chunks that a retry would then duplicate — the caller
    only forwards these once the attempt fully succeeds. A fresh runner +
    session per call keeps no state from a prior failed attempt. Raises on any
    error (including 429) so the caller can decide retry vs. failover.
    """
    runner = InMemoryRunner(agent=build_agent(stage, model=model), app_name=_APP_NAME)
    session_id = str(uuid.uuid4())
    await runner.session_service.create_session(
        app_name=_APP_NAME, user_id=actor_id, session_id=session_id
    )

    content = types.Content(role="user", parts=[types.Part(text=prompt)])
    buffered: list[dict[str, Any]] = []
    final_payload: dict[str, Any] | None = None
    final_text: str | None = None

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
                final_payload = payload
                buffered.append({"event_type": "final_response", "payload": payload})
            continue

        if event.content and event.content.parts:
            chunk = "".join(part.text or "" for part in event.content.parts)
            if chunk:
                buffered.append({"event_type": "model_chunk", "payload": {"text": chunk}})

    if final_text is None or final_payload is None:
        raise RuntimeError("agent emitted no text in final response")
    return buffered, final_text


async def stream_stage(
    stage: str, prompt: str, *, user_id: str | None = None
) -> AsyncIterator[dict[str, Any]]:
    actor_id = user_id or "system"
    chain = resolve_model_chain(stage)
    max_attempts = _retry_max_attempts()

    yield {
        "event_type": "run_started",
        "payload": {"stage": stage, "model_chain": chain},
    }

    last_error: BaseException | None = None

    for model_index, model in enumerate(chain):
        if model_index > 0:
            yield {
                "event_type": "model_failover",
                "payload": {
                    "from_model": chain[model_index - 1],
                    "to_model": model,
                    "reason": "resource_exhausted",
                },
            }

        for attempt in range(max_attempts):
            yield {
                "event_type": "model_attempt",
                "payload": {
                    "stage": stage,
                    "model": model,
                    "model_index": model_index,
                    "attempt": attempt,
                },
            }
            try:
                events, final_text = await _run_once(stage, model, prompt, actor_id)
            except Exception as exc:  # noqa: BLE001 — classify below
                last_error = exc
                if _is_resource_exhausted(exc):
                    # Transient 429: back off and retry the same model; only
                    # after exhausting this model's attempts do we fail over.
                    if attempt < max_attempts - 1:
                        await asyncio.sleep(_backoff_seconds(attempt))
                        continue
                    break  # -> next model in chain
                # Non-429 error: not a quota problem, don't retry or fail over.
                yield {
                    "event_type": "run_failed",
                    "payload": {"error": str(exc), "error_type": exc.__class__.__name__},
                }
                return

            for event in events:
                yield event
            yield {
                "event_type": "run_succeeded",
                "payload": {"final_text": final_text, "model": model},
            }
            return

    # Whole chain exhausted on 429.
    yield {
        "event_type": "run_failed",
        "payload": {
            "error": f"all models exhausted: {last_error}",
            "error_type": "ResourceExhausted",
            "model_chain": chain,
        },
    }
