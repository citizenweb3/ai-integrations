from google.genai import types

from src.ai.event_mapping import collect_tool_calls


class _Event:
    """Duck-typed ADK event: only `.content.parts` is read by the mapper."""
    def __init__(self, parts):
        self.content = types.Content(role="model", parts=parts)


def _call(name, args, id=None):
    return types.Part(function_call=types.FunctionCall(name=name, args=args, id=id))


def _resp(name, response, id=None):
    return types.Part(function_response=types.FunctionResponse(name=name, response=response, id=id))


def test_pairs_single_call_and_response():
    events = [
        _Event([_call("search_rag", {"query": "x"})]),
        _Event([_resp("search_rag", {"result": "ok"})]),
    ]
    calls = collect_tool_calls(events)
    assert len(calls) == 1
    c = calls[0]
    assert c["tool_name"] == "search_rag"
    assert "x" in c["tool_input"]
    assert "ok" in c["tool_output"]
    assert c["sequence"] == 0
    assert "latency_ms" in c


def test_pairs_two_same_name_in_order():
    events = [
        _Event([_call("query_validatorinfo", {"sql": "A"})]),
        _Event([_call("query_validatorinfo", {"sql": "B"})]),
        _Event([_resp("query_validatorinfo", {"r": 1})]),
        _Event([_resp("query_validatorinfo", {"r": 2})]),
    ]
    calls = collect_tool_calls(events)
    assert [c["sequence"] for c in calls] == [0, 1]
    assert "A" in calls[0]["tool_input"]
    assert "B" in calls[1]["tool_input"]


def test_text_only_events_ignored():
    events = [_Event([types.Part(text="hello")])]
    assert collect_tool_calls(events) == []


def test_unmatched_call_not_emitted():
    events = [_Event([_call("search_rag", {"query": "x"})])]
    assert collect_tool_calls(events) == []


def test_orphan_response_not_emitted():
    # a function_response with no preceding call must be dropped (matches the old
    # claude mapping); emitting a synthetic entry would inflate the Phase-2 gate count.
    events = [_Event([_resp("search_rag", {"r": "ok"})])]
    assert collect_tool_calls(events) == []
