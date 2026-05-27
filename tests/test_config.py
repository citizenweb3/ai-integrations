import os

from src.config import load_config


def test_gemini_and_vertex_blocks():
    cfg = load_config()
    g = cfg["gemini"]
    assert g["model_reply"] == "gemini-3.1-pro-preview"
    assert g["model_router"] == "gemini-2.5-flash-lite"
    assert g["router_provider"] == "gemini"
    assert cfg["vertex"]["location"]
    # legacy claude block must be gone
    assert "claude" not in cfg


def test_load_config_exports_vertex_flag(monkeypatch):
    monkeypatch.delenv("GOOGLE_GENAI_USE_VERTEXAI", raising=False)
    load_config()
    assert os.environ.get("GOOGLE_GENAI_USE_VERTEXAI") == "TRUE"
