"""Message listener — collects messages, triggers response pipeline."""

import re
import logging
from telethon import TelegramClient, events
from telethon.tl.types import UpdateChannelParticipant, ChannelParticipantBanned, ChannelParticipantLeft
from src.ai.llm_router import build_context_text, truncate_message_text
from src.core.response_pipeline import generate_response

log = logging.getLogger(__name__)


class Listener:
    def __init__(self, client: TelegramClient, db, responder, rag, vi_adapter,
                 rate_limiter, contacts, approval_bot, config: dict, llm_router=None):
        self.client = client
        self.db = db
        self.responder = responder
        self.rag = rag
        self.vi = vi_adapter
        self.rate_limiter = rate_limiter
        self.contacts = contacts
        self.approval = approval_bot
        self.config = config
        self.llm_router = llm_router
        self.topics = config["target"]["topics"]
        self.respond_enabled = config["strategy"]["respond_enabled"]
        self.topic_pattern = re.compile(
            "|".join(re.escape(t) for t in self.topics), re.IGNORECASE,
        )

    def _detect_topic(self, text: str) -> str | None:
        match = self.topic_pattern.search(text)
        return match.group(0).lower() if match else None

    async def start(self):
        @self.client.on(events.NewMessage(incoming=True))
        async def handler(event):
            if event.is_private and not event.is_group:
                return
            text = event.raw_text
            if not text:
                return
            has_reply = event.reply_to is not None
            if len(text) < 5 and not has_reply:
                return

            chat = await event.get_chat()
            chat_id = event.chat_id
            sender = await event.get_sender()
            if not sender or sender.bot:
                return

            sender_name = (sender.first_name or "")
            if sender.last_name:
                sender_name += f" {sender.last_name}"
            sender_name = sender_name.strip() or "?"

            topic = self._detect_topic(text)

            await self.db.save_message(
                chat_id=chat_id, message_id=event.id,
                sender_id=sender.id, sender_name=sender_name,
                text=text, topic=topic,
                reply_to_message_id=getattr(event.reply_to, 'reply_to_msg_id', None) if event.reply_to else None,
            )

            import random
            from datetime import datetime, timezone, timedelta
            group = await self.db.get_group(chat_id)
            if not group:
                hours = random.uniform(
                    self.config["limits"]["warmup_hours_min"],
                    self.config["limits"]["warmup_hours_max"],
                )
                warmup_until = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
                await self.db.upsert_group(
                    chat_id, getattr(chat, "title", None),
                    getattr(chat, "username", None),
                    getattr(chat, "participants_count", None),
                    warmup_until=warmup_until,
                )
            else:
                await self.db.upsert_group(
                    chat_id, getattr(chat, "title", None),
                    getattr(chat, "username", None),
                    getattr(chat, "participants_count", None),
                )

            await self.contacts.process_message(
                sender.id, getattr(sender, "username", None),
                sender_name, chat_id,
                has_topic=bool(topic), topic_name=topic,
            )

            if topic:
                log.info("[%s] %s: [%s] %s", getattr(chat, "title", chat_id), sender_name, topic, text[:80])

            # Check if this is a reply to our message
            reply_to = getattr(event.reply_to, 'reply_to_msg_id', None) if event.reply_to else None
            is_reply_to_us = False
            if reply_to:
                try:
                    replied_msg = await self.client.get_messages(chat_id, ids=reply_to)
                    if replied_msg and replied_msg.sender_id == (await self.client.get_me()).id:
                        is_reply_to_us = True
                except Exception:
                    pass

            if is_reply_to_us:
                log.info("[%s] %s: [reply-to-us] %s", getattr(chat, "title", chat_id), sender_name, text[:80])

            if not self.respond_enabled:
                return
            if not topic and not is_reply_to_us:
                return
            if self.responder.health.is_degraded:
                return

            can, reason = await self.rate_limiter.can_respond(chat_id, is_reply=is_reply_to_us)
            if not can:
                log.info("Rate limited [%s]: %s", getattr(chat, "title", chat_id), reason)
                return

            group_info = await self.db.get_group(chat_id)
            group_name = group_info["name"] if group_info else str(chat_id)

            if self.llm_router and not is_reply_to_us:
                ollama_config = self.config.get("ollama", {})
                max_message_tokens = int(ollama_config.get("max_message_tokens", 700))
                context_limit = int(ollama_config.get("reactive_context_messages", 3))
                context_messages = []
                if context_limit > 0:
                    context_messages = await self.db.get_recent_messages(chat_id, limit=context_limit + 1)
                    context_messages = [
                        m for m in context_messages
                        if m.get("message_id") != event.id
                    ][-context_limit:]
                context_text = build_context_text(
                    context_messages,
                    int(ollama_config.get("reactive_context_tokens", 5500)),
                    max_message_tokens,
                )
                filter_result = await self.llm_router.should_respond(
                    message=truncate_message_text(text, max_message_tokens),
                    context=context_text,
                    group_name=group_name,
                    sender_name=sender_name,
                    source="reactive",
                )
                if filter_result.decision != "disabled":
                    await self.db.save_filter_log(
                        source="reactive",
                        chat_id=chat_id,
                        message_id=event.id,
                        sender_id=sender.id,
                        sender_name=sender_name,
                        decision=filter_result.decision,
                        reason=filter_result.reason,
                        latency_ms=filter_result.latency_ms,
                        attempts=filter_result.attempts,
                    )
                    log.info(
                        "[%s] Router reactive decision=%s attempts=%d latency_ms=%d reason=%s",
                        group_name,
                        filter_result.decision,
                        filter_result.attempts,
                        filter_result.latency_ms,
                        filter_result.reason,
                    )
                if not filter_result.should_respond:
                    return

            await generate_response(
                db=self.db, responder=self.responder,
                approval=self.approval, config=self.config,
                chat_id=chat_id, message_id=event.id,
                sender_id=sender.id, sender_name=sender_name,
                text=text, topic=topic, group_name=group_name,
                is_reply_to_us=is_reply_to_us,
                use_reply_model=is_reply_to_us,
            )

        # Detect kick/ban via ChatAction
        @self.client.on(events.ChatAction)
        async def on_chat_action(event):
            me = await self.client.get_me()
            if event.user_id == me.id:
                chat = await event.get_chat()
                chat_name = getattr(chat, "title", str(event.chat_id))
                if event.kicked:
                    log.warning("KICKED from %s", chat_name)
                    await self.db.update_group_status(event.chat_id, "banned")
                    await self.approval.alert("ERROR", f"Kicked from {chat_name}")
                elif event.banned:
                    log.warning("BANNED from %s", chat_name)
                    await self.db.update_group_status(event.chat_id, "banned")
                    await self.approval.alert("ERROR", f"Banned from {chat_name}")

        # Detect mute/restrict via raw update
        @self.client.on(events.Raw(types=[UpdateChannelParticipant]))
        async def on_participant_update(event: UpdateChannelParticipant):
            me = await self.client.get_me()
            if event.user_id != me.id:
                return
            new = event.new_participant
            if isinstance(new, ChannelParticipantBanned):
                group = await self.db.get_group(event.channel_id)
                chat_name = group["name"] if group else str(event.channel_id)
                if new.banned_rights and new.banned_rights.send_messages:
                    log.warning("MUTED in %s", chat_name)
                    await self.db.update_group_status(event.channel_id, "paused")
                    await self.approval.alert("WARNING", f"Muted in {chat_name}")
                else:
                    log.warning("RESTRICTED in %s", chat_name)
                    await self.approval.alert("WARNING", f"Restricted in {chat_name}")
            elif isinstance(new, ChannelParticipantLeft):
                group = await self.db.get_group(event.channel_id)
                chat_name = group["name"] if group else str(event.channel_id)
                log.warning("REMOVED from %s", chat_name)
                await self.db.update_group_status(event.channel_id, "banned")
                await self.approval.alert("ERROR", f"Removed from {chat_name}")

        mode = "RESPOND" if self.respond_enabled else "PASSIVE"
        log.info("Listener started in %s mode", mode)
