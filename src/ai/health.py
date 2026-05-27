"""LLM backend health + degradation state machine.

Lifted from the old `ClaudeHealth` (provider-agnostic logic), with error
*detection* swapped from claude-CLI stderr string-matching to typed Gemini
exceptions. See design Topic 5.
"""

from __future__ import annotations

import asyncio
from time import monotonic
from typing import Literal

from google.auth import exceptions as _gauth

ErrorClass = Literal["auth", "transient", "config", "unknown"]

_AUTH_STATUSES = {"PERMISSION_DENIED", "UNAUTHENTICATED"}
_AUTH_CODES = {401, 403}


def classify_error(exc: BaseException) -> ErrorClass:
    """Return one of: auth | transient | config | unknown.

    auth      -> permanent lock (IAM/creds; a human must fix)
    transient -> count toward degradation, retry/backoff (429/503/timeout)
    config    -> deploy bug (bad model id / schema, 400)
    unknown   -> treat as a failure, but no special handling
    """
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return "transient"

    # ADC / token-refresh failures are raised before any HTTP response, so they
    # carry no .code/.status. They are auth problems a human must fix.
    if isinstance(exc, (_gauth.DefaultCredentialsError, _gauth.RefreshError, _gauth.GoogleAuthError)):
        return "auth"

    code = getattr(exc, "code", None)
    status = (getattr(exc, "status", None) or "").upper()

    if code in _AUTH_CODES or status in _AUTH_STATUSES:
        return "auth"
    if code == 429 or status in {"RESOURCE_EXHAUSTED"}:
        return "transient"
    if code in (400, 404) or status in {"INVALID_ARGUMENT", "FAILED_PRECONDITION", "NOT_FOUND"}:
        return "config"  # bad model id / region / schema — a deploy mistake, surface it
    if isinstance(code, int) and code >= 500:
        return "transient"
    return "unknown"


class LLMHealth:
    def __init__(self, failure_threshold: int = 3, pause_minutes: int = 15):
        self.consecutive_failures = 0
        self.failure_threshold = failure_threshold
        self.pause_minutes = pause_minutes
        self.degraded_until: float = 0
        self.auth_locked: bool = False
        self.auth_error_message: str | None = None

    def record_failure(self) -> bool:
        """Increment failures; return True if this crossed into degraded mode."""
        if self.auth_locked:
            return False
        self.consecutive_failures += 1
        if self.consecutive_failures >= self.failure_threshold:
            self.degraded_until = monotonic() + self.pause_minutes * 60
            return True
        return False

    def record_success(self) -> None:
        if self.auth_locked:
            return
        self.consecutive_failures = 0
        self.degraded_until = 0

    def mark_auth_failure(self, message: str | None = None) -> None:
        self.auth_locked = True
        self.auth_error_message = message
        self.consecutive_failures = 0
        self.degraded_until = 0

    @property
    def is_degraded(self) -> bool:
        if self.auth_locked:
            return True
        if self.degraded_until == 0:
            return False
        return monotonic() < self.degraded_until
