# Vertex deploy — diff against the old Claude-CLI build

Everything else in the repo (Dockerfile, docker-compose.yml, requirements.txt,
healthcheck.py, entrypoint.sh) is already wired for the Vertex + ADK + Gemini
stack. DevOps only needs to swap credentials and rebuild.

## 1. Provide the service-account JSON

Place the Vertex AI service-account key on the host at:

```
secrets/vertex-sa.json
```

Permissions (container runs as `agent`, UID 1000):

```bash
chown -R 1000:1000 secrets/
chmod 700 secrets/
chmod 600 secrets/vertex-sa.json
```

The compose file already mounts `./secrets:/secrets:ro` (read-only).

## 2. `.env` additions

Add (or replace) the following keys. All other Telegram / RAG / DB keys stay
the same.

```bash
# Vertex AI auth — ADC via the mounted SA JSON, NEVER a GOOGLE_API_KEY
GOOGLE_CLOUD_PROJECT=<your-gcp-project-id>
GOOGLE_CLOUD_LOCATION=global          # required for Gemini-3 family models
GOOGLE_APPLICATION_CREDENTIALS=/secrets/vertex-sa.json
GOOGLE_GENAI_USE_VERTEXAI=TRUE
```

`GOOGLE_GENAI_USE_VERTEXAI=TRUE` is mandatory — the responder fail-fasts at
startup if it is missing.

## 3. `.env` removals (legacy)

The Vertex stack does not need the old Claude CLI credentials. If they are
still in the prod `.env`, drop them:

```
CLAUDE_CODE_OAUTH_TOKEN
CLAUDE_ACCOUNT_UUID
CLAUDE_EMAIL
CLAUDE_ORG_UUID
```

## 4. State reset (only if it is the first deploy on the new branch)

The agent keeps Telegram group state, contacts and `ALREADY_SENT` tracking in
the SQLite file `data/agent.db`. If the old prod state should be carried over,
leave it as is. For a clean start:

```bash
rm data/agent.db
```

The schema is recreated on startup.

## 5. Build and run

```bash
docker compose build tg-growth-agent
docker compose up -d
```

## 6. Verify

On startup the agent immediately sends a heartbeat to `APPROVAL_CHAT_ID`:

```
💓 Heartbeat — YYYY-MM-DD HH:MM UTC
RAG API: ✅
ValidatorInfo DB: ✅
Groups: N | Messages: N
Responses: N total / N today / N pending
```

If either `RAG API` or `ValidatorInfo DB` shows `❌`, fix the corresponding
env-var and rebuild.

## 7. What did NOT change

DevOps does not need to touch any of these — they ship in the branch:

- `Dockerfile` is already Python-only (no Node.js, no Claude CLI npm install).
- `docker-compose.yml` already mounts `./secrets:/secrets:ro` and sets the
  Vertex env block.
- `requirements.txt` pins `google-adk` and `google-genai`.
- `config.yaml` reply role is on the GA-quota `gemini-3.5-flash` model, with
  generous `gemini.timeout_seconds: 300` and `rag.timeout_seconds: 90` so a
  slow tool chain or a cold RAG endpoint does not kill the run.
