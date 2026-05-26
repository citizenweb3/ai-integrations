"""Vertex-only Gemini access.

Auth is via Application Default Credentials (ADC) resolved from
`GOOGLE_APPLICATION_CREDENTIALS` (a service-account JSON) or the metadata
server. The Developer API path (`GOOGLE_API_KEY`) is rejected on purpose so a
stray key cannot silently reroute traffic to a different auth/billing surface.
"""

from __future__ import annotations

import os
from functools import lru_cache

_REQUIRED = ("GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION")


def assert_vertex_env() -> None:
    """Fail fast unless the process is configured for Vertex-only access."""
    os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "TRUE")
    missing = [v for v in _REQUIRED if not os.environ.get(v)]
    if missing:
        raise RuntimeError("missing Vertex env vars: " + ", ".join(missing))
    if os.environ.get("GOOGLE_API_KEY"):
        raise RuntimeError(
            "GOOGLE_API_KEY is set but Vertex AI is the only supported path; "
            "remove GOOGLE_API_KEY from the environment"
        )


@lru_cache(maxsize=1)
def get_client():
    """Return a cached Vertex `genai.Client`. Import is lazy so tests that only
    exercise `assert_vertex_env` need no network/credentials."""
    from google import genai

    assert_vertex_env()
    return genai.Client(
        vertexai=True,
        project=os.environ["GOOGLE_CLOUD_PROJECT"],
        location=os.environ["GOOGLE_CLOUD_LOCATION"],
    )
