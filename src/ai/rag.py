"""ValidatorInfo RAG API client with circuit breaker."""

import asyncio
import aiohttp
import logging
from time import monotonic

log = logging.getLogger(__name__)


class RAGClient:
    def __init__(self, config: dict):
        self._base_url = config["validatorinfo"]["rag_api_url"]
        self._token = config["validatorinfo"]["rag_api_token"]
        self._timeout = aiohttp.ClientTimeout(total=config["rag"]["timeout_seconds"])
        self._max_retries = config["rag"]["max_retries"]
        self._cb_threshold = config["rag"]["circuit_breaker_threshold"]
        self._cb_cooldown = config["rag"]["circuit_breaker_cooldown_seconds"]
        self._session: aiohttp.ClientSession | None = None
        # Circuit breaker state
        self._consecutive_failures = 0
        self._circuit_open_until: float = 0

    async def start(self):
        self._session = aiohttp.ClientSession(timeout=self._timeout)

    async def close(self):
        if self._session:
            await self._session.close()

    @property
    def is_circuit_open(self) -> bool:
        if self._consecutive_failures < self._cb_threshold:
            return False
        return monotonic() < self._circuit_open_until

    async def search(self, query: str, limit: int = 15, speaker: str | None = None,
                     validator_id: int | None = None) -> list[dict] | None:
        """Search RAG API. Returns list of results or None if unavailable."""
        if self.is_circuit_open:
            log.warning("rag_circuit_open", cooldown_remaining=round(self._circuit_open_until - monotonic()))
            return None
        if not self._token:
            return None

        params = {"q": query, "limit": str(limit)}
        if speaker:
            params["speaker"] = speaker
        if validator_id:
            params["validatorId"] = str(validator_id)

        url = f"{self._base_url}/api/rag/search"
        headers = {"x-rag-api-token": self._token}

        for attempt in range(1, self._max_retries + 1):
            try:
                async with self._session.get(url, params=params, headers=headers) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        self._consecutive_failures = 0
                        return data.get("results", [])
                    else:
                        log.warning("rag_http_error", status=resp.status, attempt=attempt)
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                log.warning("rag_request_error", error=str(e), attempt=attempt)

            if attempt < self._max_retries:
                await asyncio.sleep(2)

        # All retries failed
        self._consecutive_failures += 1
        if self._consecutive_failures >= self._cb_threshold:
            self._circuit_open_until = monotonic() + self._cb_cooldown
            log.error("rag_circuit_opened", threshold=self._cb_threshold, cooldown=self._cb_cooldown)
        return None

    async def health_check(self) -> bool:
        """Quick check if RAG API is reachable.

        Uses the same timeout as regular search calls (config
        `rag.timeout_seconds`). A 5s hardcoded cap turned out to be
        too tight for cold-start Next.js compile of the RAG route,
        producing a misleading "degraded" log on every startup even
        when the endpoint was actually live.
        """
        try:
            async with self._session.get(
                f"{self._base_url}/api/rag/search",
                params={"q": "test", "limit": "1"},
                headers={"x-rag-api-token": self._token},
                timeout=self._timeout,
            ) as resp:
                ok = resp.status == 200
                if ok:
                    self._consecutive_failures = 0
                    self._circuit_open_until = 0
                return ok
        except Exception:
            return False
