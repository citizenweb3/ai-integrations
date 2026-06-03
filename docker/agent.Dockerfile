FROM python:3.12-slim

RUN groupadd -g 10001 appgroup && \
    useradd -u 10001 -g appgroup -m -s /bin/bash appuser

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY --chown=appuser:appgroup apps/agent/pyproject.toml ./apps/agent/pyproject.toml
COPY --chown=appuser:appgroup apps/agent/src ./apps/agent/src

RUN pip install --no-cache-dir ./apps/agent

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000

CMD ["uvicorn", "agent.main:app", "--host", "0.0.0.0", "--port", "8000"]
