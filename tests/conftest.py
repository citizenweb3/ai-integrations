"""Shared pytest fixtures. Stubs Vertex env so module imports don't fail-fast."""

import pytest


@pytest.fixture(autouse=True)
def _vertex_env(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "TRUE")
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
