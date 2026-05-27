from src.ai.llm_router import LLMRouter, FilterResult, build_context_text


def _router(provider="gemini", **gem):
    cfg = {"gemini": {"model_router": "gemini-2.5-flash-lite", "router_provider": provider, **gem}}
    return LLMRouter(cfg)


async def test_gemini_pass(monkeypatch):
    r = _router()

    async def fake_chat(prompt, timeout):
        return '{"respond": true, "reason": "staking question"}'

    monkeypatch.setattr(r, "_gemini_chat", fake_chat)
    res = await r.should_respond("msg", "ctx", "grp", "snd", "reactive")
    assert isinstance(res, FilterResult)
    assert res.should_respond is True
    assert res.decision == "pass"


async def test_gemini_skip(monkeypatch):
    r = _router()

    async def fake_chat(prompt, timeout):
        return '{"respond": false, "reason": "unrelated promo"}'

    monkeypatch.setattr(r, "_gemini_chat", fake_chat)
    res = await r.should_respond("m", "c", "g", "s", "proactive")
    assert res.should_respond is False
    assert res.decision == "skip"


async def test_disabled_fail_open():
    r = _router(router_enabled=False)
    res = await r.should_respond("m", "c", "g", "s", "reactive")
    assert res.should_respond is True
    assert res.decision == "disabled"


async def test_error_fails_open(monkeypatch):
    r = _router()

    async def boom(prompt, timeout):
        raise ValueError("vertex 503")

    monkeypatch.setattr(r, "_gemini_chat", boom)
    res = await r.should_respond("m", "c", "g", "s", "reactive")
    assert res.should_respond is True  # router failure must not block the agent
    assert res.decision in ("error_fallback", "timeout_fallback")


def test_build_context_text_budget():
    msgs = [{"sender_name": "a", "text": "hello world"}, {"sender_name": "b", "text": "more text here"}]
    out = build_context_text(msgs, token_budget=50, max_message_tokens=20)
    assert "a:" in out and "b:" in out
