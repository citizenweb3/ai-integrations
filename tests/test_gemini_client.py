import pytest

from src.ai import gemini_client


def test_assert_vertex_env_ok():
    # env set by conftest autouse fixture -> no raise
    gemini_client.assert_vertex_env()


def test_assert_vertex_env_missing_project(monkeypatch):
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    with pytest.raises(RuntimeError, match="GOOGLE_CLOUD_PROJECT"):
        gemini_client.assert_vertex_env()


def test_assert_vertex_env_rejects_api_key(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "leak")
    with pytest.raises(RuntimeError, match="GOOGLE_API_KEY"):
        gemini_client.assert_vertex_env()
