"""Routing pre-filter. Default provider is Gemini (Vertex) via google.genai;
Ollama is kept behind `router_provider: ollama` as a transition fallback."""

import asyncio
import json
import logging
from dataclasses import dataclass
from time import monotonic

import aiohttp
from pydantic import BaseModel

from src.ai.prompts import render as render_prompt

log = logging.getLogger(__name__)


class _RouterDecision(BaseModel):
    """Gemini structured-output schema — matches the qwen_router JSON shape."""
    respond: bool
    reason: str


@dataclass
class FilterResult:
    should_respond: bool
    decision: str
    reason: str
    attempts: int
    latency_ms: int
    raw_output: str | None = None
    error: str | None = None


def _estimate_tokens(text: str) -> int:
    """Conservative RU/EN token approximation, isolated for later tokenizer swap."""
    if not text:
        return 0
    return max(1, (len(text) + 2) // 3)


def _truncate_to_tokens(text: str, max_tokens: int) -> str:
    if max_tokens <= 0:
        return ""
    char_limit = max_tokens * 3
    if len(text) <= char_limit:
        return text
    return text[: max(0, char_limit - 3)].rstrip() + "..."


def truncate_message_text(text: str, max_message_tokens: int) -> str:
    """Trim a standalone candidate message with the same budget as context lines."""
    return _truncate_to_tokens(text or "", max_message_tokens)


def build_context_text(
    messages: list[dict],
    token_budget: int,
    max_message_tokens: int,
) -> str:
    """Build chronological context within an approximate token budget."""
    if token_budget <= 0 or not messages:
        return ""

    selected: list[str] = []
    remaining = token_budget

    for message in reversed(messages):
        sender_name = (message.get("sender_name") or "?").strip() or "?"
        message_text = _truncate_to_tokens(message.get("text") or "", max_message_tokens)
        line = f"{sender_name}: {message_text}"
        line_tokens = _estimate_tokens(line)

        if line_tokens > remaining:
            if not selected:
                selected.append(_truncate_to_tokens(line, remaining))
            break

        selected.append(line)
        remaining -= line_tokens

    return "\n".join(reversed(selected))


class LLMRouter:
    def __init__(self, config: dict):
        self.config = config
        self._gem = config.get("gemini", {})
        self._oll = config.get("ollama", {})
        self._provider = self._gem.get("router_provider", "gemini")
        if self._provider == "ollama":
            self.enabled = bool(self._oll.get("enabled", False))
        else:
            self.enabled = bool(self._gem.get("router_enabled", True))

        self._gemini_model = self._gem.get("model_router", "gemini-2.5-flash-lite")
        # ollama transport (fallback provider)
        self._base_url = str(self._oll.get("url", "")).rstrip("/")
        self._token = self._oll.get("token", "")
        self._model = self._oll.get("model", "")
        self._session: aiohttp.ClientSession | None = None

        react_cc = int(self._gem.get("router_reactive_max_concurrent",
                                     self._oll.get("reactive_max_concurrent", 3)))
        proact_cc = int(self._gem.get("router_proactive_max_concurrent",
                                      self._oll.get("proactive_max_concurrent", 1)))
        self._reactive_sem = asyncio.Semaphore(react_cc)
        self._proactive_sem = asyncio.Semaphore(proact_cc)

    async def start(self):
        if not self.enabled:
            log.info("router_disabled")
            return
        if self._provider == "ollama":
            self._session = aiohttp.ClientSession()
            if self._oll.get("warmup_on_start", False):
                await self._warmup()

    async def close(self):
        if self._session:
            await self._session.close()
            self._session = None

    async def should_respond(
        self,
        message: str,
        context: str,
        group_name: str,
        sender_name: str,
        source: str,
    ) -> FilterResult:
        if not self.enabled:
            return FilterResult(True, "disabled", "", 0, 0)

        if self._provider == "ollama" and not self._session:
            self._session = aiohttp.ClientSession()

        route = "proactive" if source == "proactive" else "reactive"
        semaphore = self._proactive_sem if route == "proactive" else self._reactive_sem
        if self._provider == "ollama":
            timeout_seconds = int(self._oll.get(f"{route}_timeout_seconds", 120))
            max_retries = int(self._oll.get(f"max_retries_{route}", 0))
            retry_delay = float(self._oll.get("retry_delay_seconds", 0))
        else:
            timeout_seconds = int(self._gem.get(f"router_{route}_timeout_seconds", 30))
            max_retries = int(self._gem.get(f"router_max_retries_{route}", 1))
            retry_delay = float(self._gem.get("router_retry_delay_seconds", 1))
        total_attempts = max(1, 1 + max(0, max_retries))

        chat = self._chat if self._provider == "ollama" else self._gemini_chat
        prompt = self._build_filter_prompt(message, context, group_name, sender_name)
        started = monotonic()
        attempts = 0
        errors: list[str] = []
        timed_out = 0

        for attempt in range(1, total_attempts + 1):
            attempts = attempt
            try:
                async with semaphore:
                    raw_output = await chat(prompt, timeout_seconds)
                result = self._parse_output(raw_output, attempts, started)
                if result:
                    return result
                return self._fallback("parse_fallback", attempts, started, raw_output=raw_output)
            except (asyncio.TimeoutError, TimeoutError) as exc:
                timed_out += 1
                errors.append(str(exc) or "timeout")
                log.warning("router_timeout provider=%s source=%s attempt=%d timeout=%d",
                            self._provider, route, attempt, timeout_seconds)
            except Exception as exc:  # noqa: BLE001 — any transport error -> fail open
                errors.append(str(exc))
                log.warning("router_request_error provider=%s source=%s attempt=%d error=%s",
                            self._provider, route, attempt, exc)

            if attempt < total_attempts:
                await asyncio.sleep(retry_delay)

        if timed_out == attempts:
            return self._fallback("timeout_fallback", attempts, started, error="; ".join(errors))
        return self._fallback("error_fallback", attempts, started, error="; ".join(errors))

    async def _gemini_chat(self, prompt: str, timeout_seconds: int) -> str:
        """Vertex Gemini routing call. Structured JSON output ({respond, reason})
        removes the need for tolerant parsing. Sync genai call off the event loop."""
        from google.genai import types

        from src.ai.gemini_client import get_client

        client = get_client()
        cfg = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_RouterDecision,
            temperature=0,
        )
        resp = await asyncio.wait_for(
            asyncio.to_thread(
                client.models.generate_content,
                model=self._gemini_model,
                contents=prompt,
                config=cfg,
            ),
            timeout_seconds,
        )
        return resp.text or ""

    async def _warmup(self):
        if not self._session:
            return
        timeout_seconds = int(self._cfg.get("warmup_timeout_seconds", 180))
        prompt = 'Return {"respond":false,"reason":"warmup"}'
        try:
            await self._chat(prompt, timeout_seconds)
            log.info("ollama_warmup_ok")
        except Exception as exc:
            log.warning("ollama_warmup_failed error=%s", exc)

    async def _chat(self, prompt: str, timeout_seconds: int) -> str:
        if not self._session:
            raise RuntimeError("LLMRouter session is not started")

        headers = {"Content-Type": "application/json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"

        payload = {
            "model": self._model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "think": False,
            "format": self._cfg.get("format", "json"),
            "keep_alive": self._cfg.get("keep_alive", -1),
            "options": {
                "num_ctx": int(self._cfg.get("num_ctx", 8192)),
                "num_predict": int(self._cfg.get("num_predict", 256)),
                "temperature": self._cfg.get("temperature", 0),
            },
        }

        timeout = aiohttp.ClientTimeout(total=timeout_seconds)
        async with self._session.post(
            f"{self._base_url}/api/chat",
            json=payload,
            headers=headers,
            timeout=timeout,
        ) as resp:
            if resp.status < 200 or resp.status >= 300:
                body = await resp.text()
                raise ValueError(f"ollama_http_{resp.status}: {body[:200]}")
            data = await resp.json()
            return data["message"]["content"]

    def _parse_output(self, raw_output: str, attempts: int, started: float) -> FilterResult | None:
        try:
            parsed = json.loads(raw_output)
        except json.JSONDecodeError:
            return None

        if not isinstance(parsed, dict) or not isinstance(parsed.get("respond"), bool):
            return None

        should_respond = parsed["respond"]
        decision = "pass" if should_respond else "skip"
        reason = self._normalize_reason(parsed.get("reason"), should_respond)
        return FilterResult(
            should_respond=should_respond,
            decision=decision,
            reason=reason,
            attempts=attempts,
            latency_ms=self._elapsed_ms(started),
            raw_output=raw_output,
        )

    def _fallback(
        self,
        decision: str,
        attempts: int,
        started: float,
        raw_output: str | None = None,
        error: str | None = None,
    ) -> FilterResult:
        reason = {
            "timeout_fallback": "timeout fallback",
            "error_fallback": "error fallback",
            "parse_fallback": "invalid json",
        }.get(decision, "fallback")
        return FilterResult(
            should_respond=True,
            decision=decision,
            reason=reason,
            attempts=attempts,
            latency_ms=self._elapsed_ms(started),
            raw_output=raw_output,
            error=error,
        )

    @staticmethod
    def _elapsed_ms(started: float) -> int:
        return int((monotonic() - started) * 1000)

    @staticmethod
    def _normalize_reason(raw_reason: object, should_respond: bool) -> str:
        if not isinstance(raw_reason, str):
            return "relevant candidate" if should_respond else "not relevant"

        reason = raw_reason.lower()
        safe_labels = (
            (("staking", "validator", "delegat", "apr", "apy", "reward", "slashing", "governance", "нода", "валидатор", "стейк"), "staking question"),
            (("privacy", "bare metal", "self-host", "decentral", "censorship", "приват", "децентрал"), "privacy infrastructure"),
            (("resource", "link", "tool", "explorer", "community", "podcast", "ссыл", "ресурс"), "resource request"),
            (("check", "find", "compare", "verify", "monitor", "data", "провер", "сравн"), "data lookup"),
            (("uncertain", "maybe", "не уверен", "unclear"), "uncertain relevant"),
            (("price", "trading", "signal", "moon", "airdrop", "giveaway", "referral", "promo", "инвест", "трейд"), "unrelated promo"),
            (("unrelated", "announcement", "argument", "off topic", "нерелевант", "анонс"), "unrelated discussion"),
        )
        for needles, label in safe_labels:
            if any(needle in reason for needle in needles):
                return label

        return "relevant candidate" if should_respond else "not relevant"

    @staticmethod
    def _build_filter_prompt(message: str, context: str, group_name: str, sender_name: str) -> str:
        return render_prompt(
            "qwen_router",
            group_name=group_name,
            context=context,
            sender_name=sender_name,
            message=message,
        )
