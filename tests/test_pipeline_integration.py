"""Integration test: drive generate_response all the way to save_response.

This is the path the unit tests (mocked _stream_events stopping at generate())
never reached — and where the verified-send branch reads responder._model_*.
A regression here would have caught the AttributeError crash.
"""

from google.genai import types

from src.core import response_pipeline as P
from src.ai.responder import Responder
from src.storage.db import Database

_CFG = {
    "gemini": {
        "model_reactive": "gemini-3.5-flash", "effort_reactive": "low",
        "model_reply": "gemini-3.1-pro-preview", "effort_reply": "high",
        "model_verification": "gemini-3.5-flash", "effort_verification": "high",
        "timeout_seconds": 120, "max_concurrent": 3, "degraded_pause_minutes": 15,
    },
    "limits": {"messages_per_group_per_day": 10},
    "target": {"community_chat": "https://t.me/web_3_society"},
}

_VERIFIED = ('{"action":"respond",'
             '"text":"Validators secure the chain by signing and proposing blocks.",'
             '"confidence":0.95,"reason":"grounded","dm_request":false,"dm_text":""}')


class _FakeEvent:
    def __init__(self, parts, final=False):
        self.content = types.Content(role="model", parts=parts)
        self._final = final

    def is_final_response(self):
        return self._final


def _verified_events():
    return [
        _FakeEvent([types.Part(function_call=types.FunctionCall(name="search_rag", args={"query": "x"}))]),
        _FakeEvent([types.Part(function_response=types.FunctionResponse(name="search_rag", response={"r": "ok"}))]),
        _FakeEvent([types.Part(text=_VERIFIED)], final=True),
    ]


class _Approval:
    def __init__(self):
        self.sent = []

    async def send_approval(self, **kw):
        self.sent.append(kw)

    async def alert(self, level, msg):
        pass


async def test_generate_response_reaches_save_response(tmp_path):
    db = Database(str(tmp_path / "t.db"))
    await db.connect()
    try:
        responder = Responder(_CFG)

        async def fake_stream(agent, prompt):
            for e in _verified_events():
                yield e

        responder._stream_events = fake_stream
        approval = _Approval()

        rid = await P.generate_response(
            db, responder, approval, _CFG,
            chat_id=1, message_id=2, sender_id=3,
            sender_name="bob", text="How do validators secure the chain?",
            topic=None, group_name="grp", is_reply_to_us=True,
        )

        # the verified-send branch (model_used = responder._model_verification) must
        # not crash; a candidate must be saved and routed to approval
        assert rid is not None
        assert len(approval.sent) == 1
        saved = await db.get_response(rid)
        assert saved["model_name"] == responder._model_verification
    finally:
        await db.close()
