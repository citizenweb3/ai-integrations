# @bizdev/agent

Python ADK runtime. Hosts stage-specific LLM agents (research_snapshot first; revise/draft to follow).

## Layout

- `src/agent/main.py` — FastAPI app. `POST /runs/{stage}` streams NDJSON events.
- `src/agent/agents.py` — stage → ADK `Agent` factory.
- `src/agent/model_policy.py` — env-backed stage → model id resolver (mirrors TS `ModelPolicyResolver`).
- `src/agent/runner.py` — ADK `Runner` wrapper that yields `{event_type, payload}` dicts.

## Run locally

    cd apps/agent
    python -m venv .venv && . .venv/bin/activate
    pip install -e .
    cp .env.example .env  # set GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION
    gcloud auth application-default login  # ADC for local dev
    uvicorn agent.main:app --reload --port 8000

## Auth

Vertex AI is the only supported runtime. Gemini stage calls and the
RAG embedding worker both authenticate via Application Default
Credentials. Locally run `gcloud auth application-default login`; in
Docker / GCE / Cloud Run / GKE point `GOOGLE_APPLICATION_CREDENTIALS`
at a service-account JSON or rely on workload identity. Minimum IAM
role: `roles/aiplatform.user`.

## Run via Docker

    docker compose up agent
