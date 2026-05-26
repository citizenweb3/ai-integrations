"""Map ADK runner events to the `tool_calls` list shape the pipeline already
consumes (was extracted from the claude `-p` stream). One element per completed
tool call: {tool_name, tool_input, tool_output, latency_ms, sequence}.

`latency_ms` is 0 here (buffered events carry no timing); the streaming responder
enriches it with real timing in `responder.generate`.
"""

from __future__ import annotations

import json
from typing import Any, Iterable, TypedDict


class ToolCall(TypedDict):
    tool_name: str
    tool_input: str
    tool_output: str
    latency_ms: int
    sequence: int


def _dumps(value: Any) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return str(value)


def collect_tool_calls(events: Iterable[Any]) -> list[ToolCall]:
    """Pair function_call -> function_response (by id when present, else name FIFO).
    An unpaired call or an orphan response (no preceding call) is dropped."""
    pending: dict[str, list[dict]] = {}
    calls: list[ToolCall] = []

    for event in events:
        content = getattr(event, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            fc = getattr(part, "function_call", None)
            fr = getattr(part, "function_response", None)

            if fc is not None:
                key = getattr(fc, "id", None) or getattr(fc, "name", "") or ""
                pending.setdefault(key, []).append(
                    {"name": getattr(fc, "name", ""), "args": getattr(fc, "args", None) or {}}
                )
            elif fr is not None:
                name = getattr(fr, "name", "") or ""
                key = getattr(fr, "id", None) or name
                bucket = pending.get(key) or pending.get(name)
                if not bucket:  # orphan response: no preceding call -> drop
                    continue
                info = bucket.pop(0)
                calls.append({
                    "tool_name": info["name"],
                    "tool_input": _dumps(info["args"]),
                    "tool_output": _dumps(getattr(fr, "response", None)),
                    "latency_ms": 0,
                    "sequence": len(calls),
                })

    return calls
