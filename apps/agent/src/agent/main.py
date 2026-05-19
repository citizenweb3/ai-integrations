"""FastAPI ingress for the ADK runtime.

`POST /runs/{stage}` streams NDJSON events for one agent run. The caller
(currently the worker handler for `job.refresh_research_snapshot`) is
responsible for persistence into `agent_runs` / `agent_run_events` /
`agent_run_artifacts` via the TS DB layer.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .agents import stage_tool_allowlist, supported_stages
from .runner import stream_stage

# Vertex AI is the only supported runtime: Gemini calls and embeddings both
# go through `{location}-aiplatform.googleapis.com` via Application Default
# Credentials. The Developer API path (`GOOGLE_API_KEY`) was removed so a
# misconfigured deployment cannot accidentally fall back to a different
# auth/billing surface mid-flight.
#
# Required env (fail fast on missing): `GOOGLE_CLOUD_PROJECT`,
# `GOOGLE_CLOUD_LOCATION`. ADC must resolve at startup either via
# `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service-account JSON or via
# the metadata server (GCE / Cloud Run / GKE workload identity). The minimum
# IAM role for the service account is `roles/aiplatform.user`.
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "TRUE")
_required_vertex_env = ("GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION")
_missing_vertex_env = [v for v in _required_vertex_env if not os.environ.get(v)]
if _missing_vertex_env:
    print(
        "missing Vertex env vars: " + ", ".join(_missing_vertex_env) + "; refusing to start",
        file=sys.stderr,
    )
    sys.exit(1)
if os.environ.get("GOOGLE_API_KEY"):
    # Hard fail rather than silently deprioritize: a stray GOOGLE_API_KEY
    # in a deployment env almost always means someone forgot to remove a
    # legacy var, which would route the next deployment back to the
    # Developer API as soon as the Vertex flag flips off.
    print(
        "GOOGLE_API_KEY is set but Vertex AI is the only supported path; "
        "remove GOOGLE_API_KEY from the environment",
        file=sys.stderr,
    )
    sys.exit(1)

# TODO(post-MVP): authenticate POST /runs/{stage} (shared secret or mTLS) once
# the agent listens on anything beyond the local Docker bridge.

app = FastAPI(title="bizdev-agent", version="0.0.0")


class RunRequest(BaseModel):
    prompt: str
    user_id: str | None = None


@app.get("/health")
def health() -> dict[str, Any]:
    stages = supported_stages()
    return {
        "status": "ok",
        "stages": stages,
        "tool_allowlist": {stage: stage_tool_allowlist(stage) for stage in stages},
    }


@app.post("/runs/{stage}")
async def run_stage(stage: str, request: RunRequest) -> StreamingResponse:
    if stage not in supported_stages():
        raise HTTPException(status_code=404, detail=f"unsupported stage: {stage}")

    async def generator() -> AsyncIterator[bytes]:
        async for event in stream_stage(stage, request.prompt, user_id=request.user_id):
            yield (json.dumps(event) + "\n").encode("utf-8")

    return StreamingResponse(generator(), media_type="application/x-ndjson")
