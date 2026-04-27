"""Claude-powered responder via claude -p subprocess."""

import asyncio
import hashlib
import json
import logging
import shutil
from pathlib import Path
from time import monotonic

from src.ai.prompts import render as render_prompt

log = logging.getLogger(__name__)


def _extract_json(raw: str) -> dict | None:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(raw[start:end + 1])
        except json.JSONDecodeError:
            pass
    return None


class ClaudeHealth:
    def __init__(self, failure_threshold: int = 3, pause_minutes: int = 15):
        self.consecutive_failures = 0
        self.failure_threshold = failure_threshold
        self.pause_minutes = pause_minutes
        self.degraded_until: float = 0
        self.auth_locked: bool = False
        self.auth_error_message: str | None = None

    def record_failure(self) -> bool:
        if self.auth_locked:
            return False
        self.consecutive_failures += 1
        if self.consecutive_failures >= self.failure_threshold:
            self.degraded_until = monotonic() + self.pause_minutes * 60
            return True
        return False

    def record_success(self):
        if self.auth_locked:
            return
        self.consecutive_failures = 0
        self.degraded_until = 0

    def mark_auth_failure(self, message: str | None = None):
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


class Responder:
    def __init__(self, config: dict):
        self.config = config
        self._model = config["claude"]["model"]
        self._effort = config["claude"].get("effort", "medium")
        self._model_reply = config["claude"].get("model_reply", self._model)
        self._effort_reply = config["claude"].get("effort_reply", self._effort)
        self._model_verification = config["claude"].get("model_verification", self._model)
        self._effort_verification = config["claude"].get("effort_verification", self._effort)
        self._model_health = config["claude"].get("model_health", self._model)
        self._effort_health = config["claude"].get("effort_health", "low")
        self._timeout = config["claude"]["timeout_seconds"]
        self._claude_bin = shutil.which("claude") or "claude"
        self._cwd = "/app" if Path("/app").exists() else str(Path(__file__).resolve().parent.parent)
        self._semaphore = asyncio.Semaphore(config["claude"]["max_concurrent"])
        self.health = ClaudeHealth(
            failure_threshold=3,
            pause_minutes=config["claude"]["degraded_pause_minutes"],
        )

    async def generate(
        self,
        prompt: str,
        use_reply_model: bool = False,
        is_verification: bool = False,
    ) -> tuple[dict | None, list[dict]]:
        self.last_error = None
        self.last_error_detail = None

        if self.health.auth_locked:
            self.last_error = "auth_locked"
            return None, []
        if self.health.is_degraded:
            remaining = round(self.health.degraded_until - monotonic())
            self.last_error = f"degraded_mode ({remaining}s remaining)"
            log.warning("claude_degraded, resume_in=%d", remaining)
            return None, []

        if is_verification:
            model, effort = self._model_verification, self._effort_verification
        elif use_reply_model:
            model, effort = self._model_reply, self._effort_reply
        else:
            model, effort = self._model, self._effort

        last_tool_calls: list[dict] = []
        for attempt in range(2):
            parsed, tool_calls = await self._invoke(prompt, model=model, effort=effort)
            last_tool_calls = tool_calls
            if parsed is not None:
                self.health.record_success()
                return parsed, tool_calls
            if self.health.auth_locked:
                self.last_error = "auth_error"
                return None, tool_calls
            if attempt == 0:
                log.info("claude_retry, delay=5")
                await asyncio.sleep(5)

        entered_degraded = self.health.record_failure()
        if entered_degraded:
            self.last_error = "degraded_mode_entered"
            log.critical("claude_degraded_mode_entered, pause_minutes=%d", self.health.pause_minutes)
        else:
            self.last_error = "consecutive_failure"
        return None, last_tool_calls

    async def _invoke(
        self,
        prompt: str,
        model: str | None = None,
        effort: str | None = None,
    ) -> tuple[dict | None, list[dict]]:
        model = model or self._model
        effort = effort or self._effort
        tool_calls: list[dict] = []

        async with self._semaphore:
            try:
                proc = await asyncio.create_subprocess_exec(
                    self._claude_bin, "-p", prompt,
                    "--model", model,
                    "--effort", effort,
                    "--output-format", "stream-json",
                    "--verbose",
                    "--dangerously-skip-permissions",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=self._cwd,
                )
            except FileNotFoundError:
                if not self.health.auth_locked:
                    log.critical("claude_not_found, msg=claude CLI not installed")
                self.health.mark_auth_failure("claude CLI not installed")
                return None, tool_calls

            pending: dict[str, dict] = {}
            final_text_holder: list[str | None] = [None]
            stderr_buf = bytearray()

            async def drain_stdout():
                while True:
                    line = await proc.stdout.readline()
                    if not line:
                        return
                    try:
                        evt = json.loads(line.decode("utf-8", errors="replace").strip())
                    except json.JSONDecodeError:
                        continue
                    etype = evt.get("type")
                    if etype == "assistant":
                        msg = evt.get("message") or {}
                        for block in msg.get("content") or []:
                            if not isinstance(block, dict):
                                continue
                            if block.get("type") == "tool_use":
                                tu_id = block.get("id") or ""
                                pending[tu_id] = {
                                    "tool_name": block.get("name", ""),
                                    "tool_input": json.dumps(block.get("input") or {}, ensure_ascii=False),
                                    "started_at": monotonic(),
                                }
                    elif etype == "user":
                        msg = evt.get("message") or {}
                        for block in msg.get("content") or []:
                            if not isinstance(block, dict) or block.get("type") != "tool_result":
                                continue
                            tu_id = block.get("tool_use_id")
                            info = pending.pop(tu_id, None)
                            if info is None:
                                continue
                            output = block.get("content", "")
                            if not isinstance(output, str):
                                try:
                                    output = json.dumps(output, ensure_ascii=False)
                                except (TypeError, ValueError):
                                    output = str(output)
                            tool_calls.append({
                                "tool_name": info["tool_name"],
                                "tool_input": info["tool_input"],
                                "tool_output": output,
                                "latency_ms": int((monotonic() - info["started_at"]) * 1000),
                                "sequence": len(tool_calls),
                            })
                    elif etype == "result":
                        result_text = evt.get("result")
                        if isinstance(result_text, str):
                            final_text_holder[0] = result_text

            async def drain_stderr():
                while True:
                    chunk = await proc.stderr.read(4096)
                    if not chunk:
                        return
                    stderr_buf.extend(chunk)

            try:
                await asyncio.wait_for(
                    asyncio.gather(drain_stdout(), drain_stderr(), proc.wait()),
                    timeout=self._timeout,
                )
            except asyncio.TimeoutError:
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=5)
                except asyncio.TimeoutError:
                    proc.kill()
                self.last_error = f"timeout ({self._timeout}s)"
                log.error("claude_timeout, timeout=%d", self._timeout)
                return None, tool_calls

            stderr_text = stderr_buf.decode("utf-8", errors="replace")
            final_text = final_text_holder[0]

            if proc.returncode != 0:
                stdout_preview = (final_text or "")[:500]
                combined = (stderr_text + " " + stdout_preview).lower()
                if any(kw in combined for kw in ("auth", "unauthorized", "token expired", "login")):
                    self.last_error = "auth_error"
                    if not self.health.auth_locked:
                        log.critical("claude_auth_error, stderr=%s, stdout=%s", stderr_text[:500], stdout_preview)
                    self.health.mark_auth_failure(stderr_text[:500] or stdout_preview or "auth error")
                    return None, tool_calls
                if any(kw in combined for kw in ("rate limit", "too many", "429", "hit your limit", "resets")):
                    self.last_error = "rate_limit"
                    self.last_error_detail = stdout_preview.strip() or stderr_text.strip()
                else:
                    self.last_error = f"exit_code_{proc.returncode}"
                log.error("claude_exit_error, returncode=%d, stderr=%s", proc.returncode, stderr_text[:500])
                return None, tool_calls

            if not final_text:
                self.last_error = "no_result_event"
                log.error("claude_no_result, stderr=%s", stderr_text[:200])
                return None, tool_calls

            parsed = _extract_json(final_text)
            if parsed is None:
                self.last_error = "parse_error"
                log.error("claude_parse_error, raw_preview=%s", final_text[:200])
                return None, tool_calls

            return parsed, tool_calls

    def make_prompt(self, group_name: str, recent_messages: str,
                    sender_name: str, message_text: str,
                    is_reply_to_us: bool = False,
                    dm_already_sent: dict | None = None) -> str:
        parts = [
            render_prompt(
                "responder_main",
                group_name=group_name,
                recent_messages=recent_messages,
                is_reply_to_us=str(bool(is_reply_to_us)).lower(),
            )
        ]

        if dm_already_sent:
            sent_list = [k for k, v in dm_already_sent.items() if v]
            if sent_list:
                parts.append(render_prompt(
                    "snippets/already_sent",
                    sent_list=", ".join(sent_list),
                ))

        if is_reply_to_us:
            parts.append(render_prompt(
                "snippets/follow_up",
                sender_name=sender_name,
                message_text=message_text,
            ))
        else:
            parts.append(render_prompt(
                "snippets/new_message",
                sender_name=sender_name,
                message_text=message_text,
            ))

        community_chat = self.config.get("target", {}).get("community_chat", "https://t.me/web_3_society")
        parts.append(render_prompt(
            "snippets/closing_instructions",
            community_chat=community_chat,
        ))
        return "\n\n".join(parts)

    def make_verification_prompt(self, original_question: str,
                                    draft_response: str,
                                    initial_confidence: float) -> str:
        return render_prompt(
            "responder_verification",
            original_question=original_question,
            draft_response=draft_response,
            initial_confidence=f"{initial_confidence:.2f}",
        )

    def prompt_hash(self, prompt: str) -> str:
        return hashlib.sha256(prompt.encode()).hexdigest()[:16]

    async def health_check(self) -> bool:
        if self.health.auth_locked:
            return False
        parsed, _ = await self._invoke(
            'Respond as JSON: {"ok": true, "action": "skip", "confidence": 0, "reason": "health check"}',
            model=self._model_health,
            effort=self._effort_health,
        )
        return parsed is not None and not self.health.auth_locked
