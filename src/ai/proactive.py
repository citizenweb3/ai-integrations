"""Proactive scanner — finds threads worth responding to every 10 minutes."""

import json
import logging
import random
from datetime import datetime, timezone, timedelta
from src.ai.llm_router import build_context_text, truncate_message_text

log = logging.getLogger(__name__)

# Topic keywords by priority
class ProactiveScanner:
    def __init__(self, db, responder, rag, vi_adapter, rate_limiter, approval_bot, config: dict, llm_router=None):
        self.db = db
        self._topics = [t.lower() for t in config["target"]["topics"]]
        self.responder = responder
        self.rag = rag
        self.vi = vi_adapter
        self.rate_limiter = rate_limiter
        self.approval = approval_bot
        self.config = config
        self.llm_router = llm_router
        self.threshold = config["proactive"]["score_threshold"]
        self.max_candidates = config["proactive"]["max_candidates_per_cycle"]
        self.window_minutes = config["proactive"].get("window_minutes", 30)

    async def run_cycle(self):
        """One proactive scan cycle. Called every 10 minutes from main.py."""
        log.info("Proactive cycle started")

        if self.responder.health.is_degraded:
            log.info("Proactive: skipped, Claude degraded")
            return

        groups = await self.db.get_active_groups()
        log.info("Proactive: %d active groups", len(groups))
        candidates = []

        for group in groups:
            chat_id = group["chat_id"]

            # Rate limit check
            can, reason = await self.rate_limiter.can_respond(chat_id)
            if not can:
                log.info("Proactive: group %s rate limited: %s", group.get("name"), reason)
                continue

            # No group-level blocking — responded=TRUE is set at response creation, not at sent
            # So proactive only sees truly unresponded messages
            messages = await self.db.get_messages_since(chat_id, since_minutes=self.window_minutes)
            messages = [m for m in messages if not m.get("responded")]

            # Filter out messages that have an active response (not rejected/expired/superseded)
            if messages:
                async with self.db.db.execute(
                    "SELECT DISTINCT in_reply_to FROM responses WHERE chat_id = ? AND in_reply_to IS NOT NULL AND status IN ('candidate', 'pending_approval', 'queued', 'sending', 'sent')",
                    (chat_id,),
                ) as cur:
                    active_response_ids = {row[0] for row in await cur.fetchall()}
                messages = [m for m in messages if m.get("message_id") not in active_response_ids]
            log.info("Proactive: group %s has %d unresponded messages", group.get("name"), len(messages))
            if not messages:
                continue

            # Find threads (group by reply_to_message_id)
            threads = self._extract_threads(messages)

            for thread in threads:
                score = self._score_thread(thread, group)
                last_text = thread[-1].get("text", "")[:50]
                log.info("Proactive: thread score=%.2f (threshold=%.2f) text='%s'", score, self.threshold, last_text)
                if score >= self.threshold:
                    candidates.append({
                        "chat_id": chat_id,
                        "group": group,
                        "thread": thread,
                        "score": score,
                    })

        # Sort by score, take top N
        candidates.sort(key=lambda c: c["score"], reverse=True)
        candidates = candidates[:self.max_candidates]

        for candidate in candidates:
            await self._process_candidate(candidate)

        if candidates:
            log.info("Proactive cycle: %d candidates processed", len(candidates))

    def _extract_threads(self, messages: list[dict]) -> list[list[dict]]:
        """Group messages into threads by reply_to_message_id."""
        threads_map: dict[int, list[dict]] = {}
        standalone = []
        for m in messages:
            reply_to = m.get("reply_to_message_id")
            if reply_to:
                threads_map.setdefault(reply_to, []).append(m)
            else:
                standalone.append(m)
        # Each standalone message is its own "thread"
        result = [[m] for m in standalone]
        # Add reply threads
        for msgs in threads_map.values():
            result.append(sorted(msgs, key=lambda m: m.get("timestamp", "")))
        return result

    def _score_thread(self, thread: list[dict], group: dict) -> float:
        """Score a thread using 7 factors."""
        now = datetime.now(timezone.utc)
        last_msg = thread[-1]

        # 1. Recency (0.2)
        try:
            msg_time = datetime.fromisoformat(last_msg["timestamp"]).replace(tzinfo=timezone.utc)
            minutes_ago = (now - msg_time).total_seconds() / 60
        except (ValueError, TypeError, KeyError):
            minutes_ago = 999
        if minutes_ago <= 30:
            recency = 1.0
        elif minutes_ago <= 120:
            recency = 1.0 - (minutes_ago - 30) / 90
        else:
            recency = 0.0

        # 2. Unanswered question (0.3)
        unanswered = 0.0
        last_text = last_msg.get("text", "")
        if "?" in last_text and minutes_ago >= 5:
            if minutes_ago <= 30:
                unanswered = 1.0
            elif minutes_ago <= 120:
                unanswered = 0.5
            else:
                unanswered = 0.1

        # 3. Topic relevance (0.2) — uses same keywords as reactive from config
        combined_text = " ".join(m.get("text", "").lower() for m in thread)
        matches = sum(1 for kw in self._topics if kw in combined_text)
        if matches >= 3:
            topic = 1.0
        elif matches >= 2:
            topic = 0.7
        elif matches >= 1:
            topic = 0.4
        else:
            topic = 0.0

        # 4. Thread heat (0.1)
        recent_msgs = [m for m in thread if self._minutes_ago(m) < 15]
        if len(recent_msgs) >= 5:
            heat = 1.0
        elif len(recent_msgs) >= 3:
            heat = 0.7
        elif len(recent_msgs) >= 2:
            heat = 0.3
        else:
            heat = 0.0

        # 5. Novelty (0.1) — how long since agent last responded in this group
        last_resp = group.get("last_response_at")
        if not last_resp:
            novelty = 1.0
        else:
            try:
                resp_time = datetime.fromisoformat(last_resp).replace(tzinfo=timezone.utc)
                hours_since = (now - resp_time).total_seconds() / 3600
            except (ValueError, TypeError):
                hours_since = 999
            if hours_since >= 4:
                novelty = 1.0
            elif hours_since >= 2:
                novelty = 0.7
            elif hours_since >= 1:
                novelty = 0.3
            else:
                novelty = 0.0

        score = (recency * 0.2 + unanswered * 0.35 + topic * 0.25 +
                 heat * 0.1 + novelty * 0.1)

        return round(score, 3)

    def _minutes_ago(self, msg: dict) -> float:
        try:
            ts = datetime.fromisoformat(msg["timestamp"]).replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc) - ts).total_seconds() / 60
        except (ValueError, TypeError, KeyError):
            return 999

    async def _process_candidate(self, candidate: dict):
        """Send candidate thread to Claude via shared pipeline."""
        from src.core.response_pipeline import generate_response

        group = candidate["group"]
        thread = candidate["thread"]
        chat_id = candidate["chat_id"]
        last_msg = thread[-1]
        group_name = group["name"] or str(chat_id)
        sender_name = last_msg.get("sender_name", "[proactive]")
        message_id = last_msg.get("message_id")

        if self.llm_router:
            ollama_config = self.config.get("ollama", {})
            max_message_tokens = int(ollama_config.get("max_message_tokens", 700))
            context_limit = int(ollama_config.get("proactive_context_messages", 30))
            context_thread = thread[:-1]
            if context_limit > 0:
                context_thread = context_thread[-context_limit:]
            else:
                context_thread = []
            context_text = build_context_text(
                context_thread,
                int(ollama_config.get("proactive_context_tokens", 5500)),
                max_message_tokens,
            )
            filter_result = await self.llm_router.should_respond(
                message=truncate_message_text(last_msg.get("text", ""), max_message_tokens),
                context=context_text,
                group_name=group_name,
                sender_name=sender_name,
                source="proactive",
            )
            if filter_result.decision != "disabled":
                await self.db.save_filter_log(
                    source="proactive",
                    chat_id=chat_id,
                    message_id=message_id,
                    sender_id=last_msg.get("sender_id"),
                    sender_name=sender_name,
                    decision=filter_result.decision,
                    reason=filter_result.reason,
                    latency_ms=filter_result.latency_ms,
                    attempts=filter_result.attempts,
                )
                log.info(
                    "[%s] Router proactive decision=%s attempts=%d latency_ms=%d reason=%s",
                    group_name,
                    filter_result.decision,
                    filter_result.attempts,
                    filter_result.latency_ms,
                    filter_result.reason,
                )
            if not filter_result.should_respond:
                return

        response_id = await generate_response(
            db=self.db, responder=self.responder,
            approval=self.approval, config=self.config,
            chat_id=chat_id, message_id=message_id,
            sender_id=None, sender_name=sender_name,
            text=last_msg.get("text", ""), topic=None,
            group_name=group_name,
            is_reply_to_us=False,
            use_reply_model=False,
            is_proactive=True,
        )

        if response_id:
            log.info("[%s] Proactive candidate sent to approval (score=%.2f)", group_name, candidate["score"])
