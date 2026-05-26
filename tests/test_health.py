import asyncio

from google.genai import errors as gerrors

from src.ai.health import LLMHealth, classify_error


def _client_error(code, status):
    return gerrors.ClientError(code, {"error": {"message": status, "status": status, "code": code}})


def _server_error(code, status):
    return gerrors.ServerError(code, {"error": {"message": status, "status": status, "code": code}})


# --- state machine ---

def test_degrades_after_threshold():
    h = LLMHealth(failure_threshold=3, pause_minutes=15)
    assert h.record_failure() is False
    assert h.record_failure() is False
    assert h.record_failure() is True   # 3rd consecutive -> degraded
    assert h.is_degraded is True


def test_success_resets():
    h = LLMHealth(3, 15)
    h.record_failure()
    h.record_success()
    assert h.consecutive_failures == 0
    assert h.is_degraded is False


def test_auth_lock_is_permanent():
    h = LLMHealth(3, 15)
    h.mark_auth_failure("bad creds")
    assert h.auth_locked is True
    assert h.is_degraded is True
    h.record_success()                  # success must not clear an auth lock
    assert h.auth_locked is True


# --- error classification ---

def test_classify_auth():
    assert classify_error(_client_error(403, "PERMISSION_DENIED")) == "auth"
    assert classify_error(_client_error(401, "UNAUTHENTICATED")) == "auth"


def test_classify_transient():
    assert classify_error(_client_error(429, "RESOURCE_EXHAUSTED")) == "transient"
    assert classify_error(_server_error(503, "UNAVAILABLE")) == "transient"
    assert classify_error(asyncio.TimeoutError()) == "transient"


def test_classify_config():
    assert classify_error(_client_error(400, "INVALID_ARGUMENT")) == "config"


def test_classify_unknown():
    assert classify_error(ValueError("x")) == "unknown"
