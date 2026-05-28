from src.ai import tools


async def test_search_rag_formats_results(monkeypatch):
    async def fake_fetch(query, limit):
        return [{
            "quote": "stake well",
            "speakerName": "Serj",
            "speakerRole": "GUEST",
            "episodeTitle": "Ep1",
            "episodeUrl": "https://podcast.citizenweb3.com/1",
        }]
    monkeypatch.setattr(tools, "_rag_fetch", fake_fetch)
    out = await tools.search_rag("staking")
    assert "stake well" in out
    assert "Serj" in out
    assert "Ep1" in out
    assert "(GUEST)" in out


async def test_search_rag_renders_host_and_handles_missing_role(monkeypatch):
    """HOST speakers get an explicit role marker so the LLM can apply CW3
    disclosure rules. Missing/empty speakerRole degrades gracefully — no
    empty parens, no exception."""
    async def fake_fetch(query, limit):
        return [
            {
                "quote": "PoS centralization is the real risk",
                "speakerName": "Serge Vagaytsev",
                "speakerRole": "HOST",
                "episodeTitle": "Ep142",
                "episodeUrl": "https://podcast.citizenweb3.com/142",
            },
            {
                "quote": "we need more sovereign infra",
                "speakerName": "Anonymous",
                # no speakerRole key — older API contract / null value
                "episodeTitle": "Ep77",
                "episodeUrl": "https://podcast.citizenweb3.com/77",
            },
        ]
    monkeypatch.setattr(tools, "_rag_fetch", fake_fetch)
    out = await tools.search_rag("centralization")
    # HOST result includes the role marker
    assert "Serge Vagaytsev (HOST)" in out
    # Missing-role result renders without parens (no "()" anywhere)
    assert "()" not in out
    # Both quotes are present so the loop did not crash on the missing field
    assert "PoS centralization" in out
    assert "sovereign infra" in out


async def test_search_rag_empty(monkeypatch):
    async def fake_fetch(query, limit):
        return []
    monkeypatch.setattr(tools, "_rag_fetch", fake_fetch)
    out = await tools.search_rag("nothing")
    assert "no" in out.lower() or out.strip() != ""


async def test_search_rag_error_returned(monkeypatch):
    async def fake_fetch(query, limit):
        raise RuntimeError("rag down")
    monkeypatch.setattr(tools, "_rag_fetch", fake_fetch)
    out = await tools.search_rag("x")
    assert "error" in out.lower()
