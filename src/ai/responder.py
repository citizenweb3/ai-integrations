"""Claude-powered responder via claude -p subprocess."""

import asyncio
import hashlib
import json
import logging
import shutil
from pathlib import Path
from time import monotonic

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
        self._model_reply = config["claude"].get("model_reply", self._model)
        self._timeout = config["claude"]["timeout_seconds"]
        self._claude_bin = shutil.which("claude") or "claude"
        self._cwd = "/app" if Path("/app").exists() else str(Path(__file__).resolve().parent.parent)
        self._semaphore = asyncio.Semaphore(config["claude"]["max_concurrent"])
        self.health = ClaudeHealth(
            failure_threshold=3,
            pause_minutes=config["claude"]["degraded_pause_minutes"],
        )

    async def generate(self, prompt: str, use_reply_model: bool = False) -> dict | None:
        self.last_error = None
        self.last_error_detail = None

        if self.health.auth_locked:
            self.last_error = "auth_locked"
            return None
        if self.health.is_degraded:
            remaining = round(self.health.degraded_until - monotonic())
            self.last_error = f"degraded_mode ({remaining}s remaining)"
            log.warning("claude_degraded, resume_in=%d", remaining)
            return None

        model = self._model_reply if use_reply_model else self._model
        for attempt in range(2):
            result = await self._invoke(prompt, model=model)
            if result is not None:
                self.health.record_success()
                return result
            if self.health.auth_locked:
                self.last_error = "auth_error"
                return None
            if attempt == 0:
                log.info("claude_retry, delay=5")
                await asyncio.sleep(5)

        entered_degraded = self.health.record_failure()
        if entered_degraded:
            self.last_error = "degraded_mode_entered"
            log.critical("claude_degraded_mode_entered, pause_minutes=%d", self.health.pause_minutes)
        else:
            self.last_error = "consecutive_failure"
        return None

    async def _invoke(self, prompt: str, model: str | None = None) -> dict | None:
        model = model or self._model
        async with self._semaphore:
            try:
                proc = await asyncio.create_subprocess_exec(
                    self._claude_bin, "-p", prompt,
                    "--model", model,
                    "--output-format", "text",
                    "--dangerously-skip-permissions",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=self._cwd,
                )

                try:
                    stdout, stderr = await asyncio.wait_for(
                        proc.communicate(), timeout=self._timeout
                    )
                except asyncio.TimeoutError:
                    proc.terminate()
                    try:
                        await asyncio.wait_for(proc.wait(), timeout=5)
                    except asyncio.TimeoutError:
                        proc.kill()
                    self.last_error = f"timeout ({self._timeout}s)"
                    log.error("claude_timeout, timeout=%d", self._timeout)
                    return None

                stderr_text = stderr.decode(errors="replace")

                if proc.returncode != 0:
                    stdout_text = stdout.decode(errors="replace")[:500] if stdout else ""
                    combined = (stderr_text + " " + stdout_text).lower()
                    if any(kw in combined for kw in ("auth", "unauthorized", "token expired", "login")):
                        self.last_error = "auth_error"
                        if not self.health.auth_locked:
                            log.critical("claude_auth_error, stderr=%s, stdout=%s", stderr_text[:500], stdout_text)
                        self.health.mark_auth_failure(stderr_text[:500] or stdout_text[:500] or "auth error")
                        return None
                    if any(kw in combined for kw in ("rate limit", "too many", "429", "hit your limit", "resets")):
                        self.last_error = "rate_limit"
                        self.last_error_detail = stdout_text.strip() or stderr_text.strip()
                    else:
                        self.last_error = f"exit_code_{proc.returncode}"
                    log.error("claude_exit_error, returncode=%d, stderr=%s, stdout=%s", proc.returncode, stderr_text[:500], stdout_text)
                    return None

                raw = stdout.decode(errors="replace").strip()
                parsed = _extract_json(raw)
                if parsed is None:
                    self.last_error = "parse_error"
                    log.error("claude_parse_error, raw_preview=%s", raw[:200])
                    return None

                return parsed

            except FileNotFoundError:
                if not self.health.auth_locked:
                    log.critical("claude_not_found, msg=claude CLI not installed")
                self.health.mark_auth_failure("claude CLI not installed")
                return None

    def make_prompt(self, group_name: str, language: str, recent_messages: str,
                    sender_name: str, message_text: str,
                    is_reply_to_us: bool = False,
                    already_offered: dict | None = None,
                    dm_already_sent: dict | None = None) -> str:
        parts = [
            f"GROUP: {group_name}",
            f"LANGUAGE: {language}",
            f"RECENT MESSAGES:\n{recent_messages}",
        ]

        if already_offered:
            offered_list = [k for k, v in already_offered.items() if v]
            if offered_list:
                parts.append(
                    f"ALREADY MENTIONED in group chat: {', '.join(offered_list)}. "
                    "Do NOT mention these again unless the person explicitly asks."
                )

        if dm_already_sent:
            sent_list = [k for k, v in dm_already_sent.items() if v]
            if sent_list:
                parts.append(
                    f"ALREADY SENT via DM to this person: {', '.join(sent_list)}. "
                    "Do NOT include these links in dm_text again."
                )

        if is_reply_to_us:
            parts.append(
                f"CONTINUING CONVERSATION — {sender_name} replied to YOUR previous message:\n{message_text}\n\n"
                "REMINDER: This is STEP 2. You MUST: 1) mention Citizen Web3 if topic is about staking/privacy/validators, "
                "2) mention the right resource (ValidatorInfo/Podcast/B.V.C./Web3 Society), "
                "3) offer to send links if you haven't yet."
            )
        else:
            parts.append(f"NEW MESSAGE from {sender_name}:\n{message_text}")

        community_chat = self.config.get("target", {}).get("community_chat", "https://t.me/web_3_society")
        parts.append(
            f"RESPOND IN {language} ONLY. Both text and dm_text must be in {language}. "
            "MANDATORY TOOL USE — you MUST follow these steps for EVERY response, no exceptions: "
            "1) query-db.py — check ValidatorInfo for on-chain data. "
            "2) WebSearch — search the web for the latest news/status about the topic. ALWAYS do this, even if you think you know the answer. Your training data is outdated. "
            "3) search-rag.py — check if relevant podcast content exists. "
            "Only AFTER completing at least steps 1 and 2, write your response using VERIFIED data from tools. "
            "If you mention ANY number (APR, %, validator count, commission) it MUST come from a tool call. If no tool returned it, skip. "
            "Tools: python src/tools/search-rag.py, python src/tools/query-db.py, and WebSearch (built-in). "
            "NEVER include URLs in the 'text' field. Group chats have anti-link bots. Mention names only (ValidatorInfo, CitizenWeb3 podcast). "
            "If you set dm_request: true, you MUST use search-rag.py first to find exact episode URLs for dm_text. "
            f"Links for dm_text ONLY (never in text): "
            f"community chat: {community_chat} | "
            f"explorer: https://validatorinfo.com | "
            f"podcast: https://podcast.citizenweb3.com (use search-rag.py for specific episodes). "
            "Then respond as JSON: "
            '{"action": "respond"|"skip", "text": "...", "confidence": 0-1, "reason": "...", "dm_request": false}'
        )
        return "\n\n".join(parts)

    def make_verification_prompt(self, language: str, original_question: str,
                                    draft_response: str, initial_confidence: float) -> str:
        return (
            f"VERIFICATION TASK. You wrote a draft response with confidence {initial_confidence:.2f}. "
            "Your confidence was below 0.8, so you MUST now verify it.\n\n"
            f"ORIGINAL QUESTION: {original_question}\n\n"
            f"YOUR DRAFT: {draft_response}\n\n"
            "NOW DO THIS:\n"
            "1) Use python src/tools/query-db.py to check ValidatorInfo database for relevant on-chain data\n"
            "2) Use WebSearch to find the latest news and facts about this topic\n"
            "3) Use python src/tools/search-rag.py if podcast content might be relevant\n\n"
            "After verification, respond with an UPDATED answer based on what you found. "
            "If tools confirmed your draft is accurate, set confidence >= 0.8. "
            "If tools showed your draft was wrong or you found no data to verify, set action to 'skip'. "
            "Do NOT repeat your draft without verifying. You MUST call at least one tool.\n\n"
            f"RESPOND IN {language} ONLY.\n"
            "Respond as JSON: "
            '{"action": "respond"|"skip", "text": "...", "confidence": 0-1, "reason": "...", "dm_request": false}'
        )

    def prompt_hash(self, prompt: str) -> str:
        return hashlib.sha256(prompt.encode()).hexdigest()[:16]

    async def health_check(self) -> bool:
        if self.health.auth_locked:
            return False
        result = await self._invoke(
            'Respond as JSON: {"ok": true, "action": "skip", "confidence": 0, "reason": "health check"}'
        )
        return result is not None and not self.health.auth_locked
