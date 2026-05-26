from src.ai import tools


async def test_search_rag_formats_results(monkeypatch):
    async def fake_fetch(query, limit):
        return [{
            "quote": "stake well",
            "speakerName": "Serj",
            "episodeTitle": "Ep1",
            "episodeUrl": "https://podcast.citizenweb3.com/1",
        }]
    monkeypatch.setattr(tools, "_rag_fetch", fake_fetch)
    out = await tools.search_rag("staking")
    assert "stake well" in out
    assert "Serj" in out
    assert "Ep1" in out


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
