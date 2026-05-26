"""Gemini-powered responder via in-process ADK Runner.

Replaces the former `claude -p` subprocess. Per-role agents (reactive / reply /
verification) are built once; each `generate` call runs the role's agent through
an ephemeral `InMemoryRunner` session and returns the same
`(parsed_json | None, tool_calls)` contract the pipeline already consumes.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from time import monotonic

from google.adk.runners import InMemoryRunner
from google.genai import types

from src.ai.agents import build_agent
from src.ai.event_mapping import collect_tool_calls
from src.ai.health import LLMHealth, classify_error
from src.ai.instruction import load_instruction
from src.ai.prompts import render as render_prompt
from src.ai.thinking import thinking_config

log = logging.getLogger(__name__)

_APP_NAME = "aida"
_USER_ID = "aida"


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


class Responder:
    def __init__(self, config: dict):
        self.config = config
        gem = config["gemini"]
        self._timeout = gem["timeout_seconds"]
        self._semaphore = asyncio.Semaphore(gem["max_concurrent"])
        self.last_error: str | None = None
        self.last_error_detail: str | None = None
        self.health = LLMHealth(
            failure_threshold=3,
            pause_minutes=gem["degraded_pause_minutes"],
        )

        instruction = load_instruction()
        self._roles = {
            "reactive": (gem["model_reactive"], gem.get("effort_reactive", "low")),
            "reply": (gem["model_reply"], gem.get("effort_reply", "high")),
            "verification": (gem["model_verification"], gem.get("effort_verification", "high")),
        }
        self._agents = {
            role: build_agent(
                role,
                model=model,
                instruction=instruction,
                generate_content_config=self._gen_config(role, effort),
            )
            for role, (model, effort) in self._roles.items()
        }

    def _gen_config(self, role: str, effort: str) -> types.GenerateContentConfig:
        """Per-role generation config. Verification forces a tool call (Task 9)."""
        cfg = types.GenerateContentConfig(thinking_config=thinking_config(effort))
        return cfg

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
            log.warning("llm_degraded, resume_in=%d", remaining)
            return None, []

        if is_verification:
            role = "verification"
        elif use_reply_model:
            role = "reply"
        else:
            role = "reactive"

        last_tool_calls: list[dict] = []
        for attempt in range(2):
            parsed, tool_calls = await self._invoke_adk(prompt, role)
            last_tool_calls = tool_calls
            if parsed is not None:
                self.health.record_success()
                return parsed, tool_calls
            if self.health.auth_locked:
                self.last_error = "auth_error"
                return None, tool_calls
            if attempt == 0:
                log.info("llm_retry, delay=5")
                await asyncio.sleep(5)

        entered_degraded = self.health.record_failure()
        if entered_degraded:
            self.last_error = "degraded_mode_entered"
            log.critical("llm_degraded_mode_entered, pause_minutes=%d", self.health.pause_minutes)
        else:
            self.last_error = "consecutive_failure"
        return None, last_tool_calls

    async def _stream_events(self, agent, prompt: str):
        """Run `agent` for one user turn, yielding ADK events. Isolated seam so the
        parse / tool_calls / health logic above is unit-testable without Vertex."""
        runner = InMemoryRunner(agent=agent, app_name=_APP_NAME)
        session_id = str(uuid.uuid4())
        await runner.session_service.create_session(
            app_name=_APP_NAME, user_id=_USER_ID, session_id=session_id
        )
        content = types.Content(role="user", parts=[types.Part(text=prompt)])
        async for event in runner.run_async(
            user_id=_USER_ID, session_id=session_id, new_message=content
        ):
            yield event

    async def _invoke_adk(self, prompt: str, role: str) -> tuple[dict | None, list[dict]]:
        agent = self._agents[role]
        events: list = []
        final_text: str | None = None

        async with self._semaphore:
            async def _drain():
                nonlocal final_text
                async for event in self._stream_events(agent, prompt):
                    events.append(event)
                    if event.is_final_response() and event.content and event.content.parts:
                        joined = "".join(p.text or "" for p in event.content.parts)
                        if joined:
                            final_text = joined

            try:
                await asyncio.wait_for(_drain(), timeout=self._timeout)
            except asyncio.TimeoutError:
                self.last_error = f"timeout ({self._timeout}s)"
                log.error("llm_timeout, timeout=%d", self._timeout)
                return None, collect_tool_calls(events)
            except Exception as exc:  # noqa: BLE001 — classify, then route to health
                cls = classify_error(exc)
                if cls == "auth":
                    if not self.health.auth_locked:
                        log.critical("llm_auth_error, err=%s", str(exc)[:300])
                    self.health.mark_auth_failure(str(exc)[:500])
                    self.last_error = "auth_error"
                else:
                    self.last_error = f"{cls}:{type(exc).__name__}"
                    log.error("llm_error, cls=%s, err=%s", cls, str(exc)[:300])
                return None, collect_tool_calls(events)

        tool_calls = collect_tool_calls(events)
        if not final_text:
            self.last_error = "no_final_text"
            log.error("llm_no_final_text")
            return None, tool_calls
        parsed = _extract_json(final_text)
        if parsed is None:
            self.last_error = "parse_error"
            log.error("llm_parse_error, raw_preview=%s", final_text[:200])
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
