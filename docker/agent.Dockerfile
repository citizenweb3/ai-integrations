FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY apps/agent/pyproject.toml ./apps/agent/pyproject.toml
COPY apps/agent/src ./apps/agent/src

RUN pip install --no-cache-dir ./apps/agent

EXPOSE 8000

CMD ["uvicorn", "agent.main:app", "--host", "0.0.0.0", "--port", "8000"]
