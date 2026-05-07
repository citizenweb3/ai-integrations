"""aiogram approval bot — inline buttons, commands, alerts for Ivan."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from aiogram import Bot, Dispatcher, Router, F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

log = logging.getLogger(__name__)

router = Router()


class EditStates(StatesGroup):
    waiting_for_text = State()


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


class ApprovalBot:
    def __init__(self, db, sender, rate_limiter=None, contacts=None, config: dict | None = None):
        if config is None and isinstance(rate_limiter, dict):
            config = rate_limiter
            rate_limiter = None
            contacts = None
        if config is None:
            raise ValueError("config is required")
        self.db = db
        self.sender = sender
        self.rate_limiter = rate_limiter
        self.contacts = contacts
        self.config = config
        self.bot = Bot(token=config["telegram"]["bot_token"])
        self.dp = Dispatcher()
        self.dp.include_router(router)
        self.chat_id = config["telegram"]["approval_chat_id"]
        approval_cfg = config.get("approval", {})
        self._ttl_reactive = int(approval_cfg.get("ttl_reactive_seconds", 7200))
        self._ttl_proactive = int(approval_cfg.get("ttl_proactive_seconds", 14400))
        self._ttl_tasks: dict[int, asyncio.Task] = {}  # response_id -> ttl task

    async def start(self):
        """Start polling in background."""
        self._register_handlers()
        asyncio.create_task(self.dp.start_polling(self.bot))

    async def stop(self):
        await self.bot.session.close()

    def _register_handlers(self):
        """Register all callback and command handlers."""
        # Callback handlers for inline buttons
        router.callback_query.register(self._on_approve, F.data.startswith("approve:"))
        router.callback_query.register(self._on_reject, F.data.startswith("reject:"))
        router.callback_query.register(self._on_edit, F.data.startswith("edit:"))
        router.callback_query.register(self._on_skip_group, F.data.startswith("skip_group:"))

        # Commands
        router.message.register(self._cmd_status, Command("status"))
        router.message.register(self._cmd_pause, Command("pause"))
        router.message.register(self._cmd_resume, Command("resume"))
        router.message.register(self._cmd_groups, Command("groups"))
        router.message.register(self._cmd_note, Command("note"))
        router.message.register(self._cmd_forget, Command("forget"))
        router.message.register(self._cmd_digest, Command("digest"))
        router.message.register(self._cmd_leads, Command("leads"))
        # Edit FSM handler
        router.message.register(self._on_edit_text, EditStates.waiting_for_text)

    async def send_approval(self, response_id: int, chat_id: int, group_name: str,
                            language: str, sender_name: str, original_text: str,
                            reply_text: str, response_type: str, confidence: float,
                            rag_summary: str = "", db_summary: str = "",
                            contains_link: bool = False,
                            group_daily_count: int = 0, group_daily_limit: int = 3,
                            last_response_ago: str = "never",
                            is_proactive: bool = False):
        """Send enriched approval message to Ivan."""
        type_emoji = {"value": "\U0001f4a1", "proactive": "\U0001f504", "dm": "\U0001f534"}.get(response_type, "\U0001f4a1")
        resp = await self.db.get_response(response_id)
        filter_log = None
        if resp and resp.get("in_reply_to"):
            filter_log = await self.db.get_filter_log(resp["chat_id"], resp["in_reply_to"])

        text = (
            f"\U0001f4e9 {group_name} ({language}) | {sender_name} wrote:\n"
            f'"{original_text[:500]}"\n\n'
            f"\U0001f916 Aida wants to reply ({type_emoji} {response_type}, confidence: {confidence:.2f}):\n"
            f'"{reply_text}"\n\n'
        )

        if rag_summary or db_summary:
            text += f"\U0001f4ca Sources: {rag_summary}{', ' + db_summary if db_summary else ''}\n"

        if contains_link:
            text += f"\u26a0\ufe0f \U0001f517 Link\n"

        if filter_log:
            text += self._format_filter_log_line(filter_log) + "\n"

        text += f"\U0001f4c8 Group: {group_daily_count}/{group_daily_limit} today | Last: {last_response_ago}\n"

        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton(text="\u2705 Approve", callback_data=f"approve:{response_id}"),
                InlineKeyboardButton(text="\u274c Reject", callback_data=f"reject:{response_id}"),
            ],
            [
                InlineKeyboardButton(text="\u270f\ufe0f Edit", callback_data=f"edit:{response_id}"),
                InlineKeyboardButton(text="\u23ed\ufe0f Skip group", callback_data=f"skip_group:{chat_id}"),
            ],
        ])

        msg = await self.bot.send_message(self.chat_id, text, reply_markup=keyboard)

        # Save approval_message_id for later editing
        await self.db.update_response_status(response_id, "pending_approval",
                                              approval_message_id=msg.message_id)

        # Start TTL watchdog (configurable via approval.ttl_*_seconds in config.yaml)
        ttl = self._ttl_proactive if is_proactive else self._ttl_reactive
        self._ttl_tasks[response_id] = asyncio.create_task(
            self._ttl_watchdog(response_id, msg.message_id, ttl)
        )

    @staticmethod
    def _format_filter_log_line(filter_log: dict) -> str:
        line = (
            f"Llama: {filter_log.get('decision')}, "
            f"{filter_log.get('latency_ms') or 0}ms, "
            f"attempts={filter_log.get('attempts') or 0}"
        )
        reason = filter_log.get("reason")
        if reason:
            line += f", reason={reason}"
        return line

    async def _ttl_watchdog(self, response_id: int, message_id: int, ttl: float):
        """Expire response if not approved within TTL."""
        await asyncio.sleep(ttl)
        resp = await self.db.get_response(response_id)
        if resp and resp["status"] == "pending_approval":
            await self.db.update_response_status(response_id, "expired",
                                                  expired_at=_now())
            await self._audit_event(resp, status="expired")
            ctx = await self._build_context(resp)
            draft = resp.get("draft_text") or ""
            fb = self._format_feedback("\u23f0", f"Expired ({int(ttl/60)} min)", resp, ctx, text=draft)
            await self._edit_approval_message(fb, message_id=message_id)

    async def _on_approve(self, callback: CallbackQuery):
        response_id = int(callback.data.split(":")[1])
        resp = await self.db.get_response(response_id)
        if not resp or resp["status"] != "pending_approval":
            await callback.answer("Already handled")
            return

        await self.db.update_response_status(
            response_id, "approved", approved_at=_now(), approved_by="ivan",
            final_text=resp["draft_text"],
        )
        await self._audit_event(resp, status="approved", approval_decision="approved")

        # Cancel TTL
        if response_id in self._ttl_tasks:
            self._ttl_tasks[response_id].cancel()

        await self._attempt_delivery(response_id, callback.message)
        await callback.answer()

    async def _on_reject(self, callback: CallbackQuery):
        response_id = int(callback.data.split(":")[1])
        resp = await self.db.get_response(response_id)
        await self.db.update_response_status(response_id, "rejected")
        await self._audit_event(resp, status="rejected", approval_decision="rejected")
        if response_id in self._ttl_tasks:
            self._ttl_tasks[response_id].cancel()
        if resp:
            ctx = await self._build_context(resp)
            draft = resp.get("draft_text") or ""
            fb = self._format_feedback("\u274c", "Rejected", resp, ctx, text=draft)
            await callback.message.edit_text(fb)
        else:
            await callback.message.edit_text("\u274c Rejected (response not found)")
        await callback.answer()

    async def _on_edit(self, callback: CallbackQuery, state: FSMContext):
        response_id = int(callback.data.split(":")[1])
        resp = await self.db.get_response(response_id)
        draft = (resp.get("draft_text") or "") if resp else ""
        await state.set_state(EditStates.waiting_for_text)
        await state.set_data({"response_id": response_id, "message_id": callback.message.message_id})
        await callback.message.edit_text(
            f"\u270f\ufe0f Edit this text and send back:\n\n{draft}"
        )
        await callback.answer()

    async def _on_edit_text(self, message: Message, state: FSMContext):
        data = await state.get_data()
        response_id = data["response_id"]

        existing = await self.db.get_response(response_id)
        update_fields = dict(
            approved_at=_now(), approved_by="ivan",
            edited_text=message.text, final_text=message.text, edited_at=_now(),
        )
        if existing and existing.get("response_type") == "dm":
            update_fields["dm_text"] = message.text
        await self.db.update_response_status(response_id, "edited", **update_fields)
        await self._audit_event(
            existing, status="edited",
            approval_decision="edited", approval_edit=message.text,
        )

        if response_id in self._ttl_tasks:
            self._ttl_tasks[response_id].cancel()

        await self._attempt_delivery(response_id)
        resp = await self.db.get_response(response_id)
        if resp:
            ctx = await self._build_context(resp)
            if resp["status"] == "sent":
                fb = self._format_feedback("\u2705", "Edited & sent", resp, ctx, text=message.text)
                await message.reply(fb)
            elif resp["status"] == "queued":
                fb = self._format_feedback("\u23f3", "Edited, queued for retry", resp, ctx, text=message.text)
                await message.reply(fb)
            else:
                fb = self._format_feedback("\u274c", "Edit failed", resp, ctx, text=message.text,
                                           extra=f"Error: {resp.get('send_error', 'unknown')}")
                await message.reply(fb)
        else:
            await message.reply(f"\u274c Failed: unknown")
        await state.clear()

    async def _on_skip_group(self, callback: CallbackQuery):
        chat_id = int(callback.data.split(":")[1])
        group = await self.db.get_group(chat_id)
        if group:
            # Set responses_today to daily limit = effectively skip
            limit = self.config["limits"]["messages_per_group_per_day"]
            await self.db.update_group_field(chat_id, "responses_today", limit)
            await callback.message.edit_text(f"\u23ed\ufe0f Skipped {group['name']} for today")
        await callback.answer()

    async def _cmd_status(self, message: Message):
        stats = await self.db.stats()
        text = (
            f"\U0001f4ca Status:\n"
            f"Groups: {stats['groups']}\n"
            f"Messages: {stats['messages']}\n"
            f"Contacts: {stats['contacts']}\n"
            f"Responses today: {stats.get('responses_sent_today', 0)}\n"
            f"Total responses: {stats.get('responses_total', 0)}"
        )
        await message.reply(text)

    async def _cmd_pause(self, message: Message):
        groups = await self.db.get_active_groups()
        for g in groups:
            await self.db.update_group_status(g["chat_id"], "paused")
        await message.reply(f"\u23f8\ufe0f Paused {len(groups)} groups")

    async def _cmd_resume(self, message: Message):
        groups = await self.db.get_groups_by_status("paused")
        resumed = 0
        now = datetime.now(timezone.utc)
        for group in groups:
            target = "active"
            warmup_until = group.get("warmup_until")
            if warmup_until:
                try:
                    warmup_dt = datetime.fromisoformat(warmup_until).replace(tzinfo=timezone.utc)
                    if warmup_dt > now:
                        target = "warmup"
                except (TypeError, ValueError):
                    pass
            await self.db.update_group_status(group["chat_id"], target)
            resumed += 1
        await message.reply(f"\u25b6\ufe0f Resumed {resumed} groups")

    async def _cmd_groups(self, message: Message):
        groups = await self.db.get_groups_by_status("warmup", "active", "paused", "cooldown", "banned")
        if not groups:
            await message.reply("No tracked groups")
            return
        lines = []
        for g in groups:
            lines.append(f"\u2022 {g['name']} [{g['status']}] \u2014 {g.get('responses_today', 0)}/day")
        await message.reply("\n".join(lines))

    async def _cmd_note(self, message: Message):
        parts = (message.text or "").split(maxsplit=2)
        if len(parts) < 3:
            await message.reply("Usage: /note <chat_id> <text>")
            return
        try:
            chat_id = int(parts[1])
        except ValueError:
            await message.reply("chat_id must be an integer")
            return
        await self.db.update_group_field(chat_id, "notes", parts[2])
        await message.reply(f"\U0001f4dd Note saved for {chat_id}")

    async def _cmd_forget(self, message: Message):
        if not self.contacts:
            await message.reply("Contacts manager is not configured")
            return
        parts = (message.text or "").split(maxsplit=1)
        if len(parts) < 2:
            await message.reply("Usage: /forget <user_id>")
            return
        try:
            user_id = int(parts[1])
        except ValueError:
            await message.reply("user_id must be an integer")
            return
        await self.contacts.forget(user_id)
        await message.reply(f"\U0001f9f9 Forgot contact {user_id}")

    async def _cmd_digest(self, message: Message):
        parts = (message.text or "").split()
        days = 7
        if len(parts) > 1:
            try:
                days = int(parts[1])
            except ValueError:
                pass
        d = await self.db.get_topic_digest(days)
        lines = [f"\U0001f4ca Digest ({d['days']}d): {d['sent']} sent, {d['rejected']} rejected", ""]
        if d["top_topics"]:
            lines.append("Topics:")
            for topic, cnt in d["top_topics"]:
                lines.append(f"  {topic}: {cnt}")
            lines.append("")
        if d["active_groups"]:
            lines.append("Active groups:")
            for name, cnt in d["active_groups"]:
                lines.append(f"  {name}: {cnt} msgs")
        await message.reply("\n".join(lines) or "No data")

    async def _cmd_leads(self, message: Message):
        parts = (message.text or "").split()
        limit = 10
        if len(parts) > 1:
            try:
                limit = int(parts[1])
            except ValueError:
                pass
        contacts = await self.db.get_top_contacts(limit)
        if not contacts:
            await message.reply("No contacts yet")
            return
        lines = [f"\U0001f465 Top {len(contacts)} leads:", ""]
        for c in contacts:
            name = c.get("display_name") or "?"
            username = c.get("username")
            name_str = f"{name} (@{username})" if username else name
            score = c.get("relevance_score", 0)
            msgs = c.get("message_count", 0)
            staking = c.get("staking_message_count", 0)
            groups = c.get("groups_in_common", 0)
            lines.append(f"{name_str}")
            lines.append(f"  score: {score:.2f} | msgs: {msgs} | staking: {staking} | groups: {groups}")
        await message.reply("\n".join(lines))

    async def alert(self, level: str, text: str):
        """Send alert to Ivan."""
        prefix = {"CRITICAL": "\U0001f534", "ERROR": "\U0001f7e0", "WARNING": "\U0001f7e1"}.get(level, "\u26aa")
        await self.bot.send_message(self.chat_id, f"{prefix} {text}")

    async def process_queue(self):
        queued = await self.db.get_responses_by_status("queued")
        for resp in queued:
            if self._seconds_until_retry(resp) > 0:
                continue
            await self._attempt_delivery(resp["id"])

    async def _build_context(self, resp: dict) -> dict:
        """Gather group, original message, and contact info for feedback."""
        group = await self.db.get_group(resp["chat_id"])
        group_name = group["name"] if group else str(resp["chat_id"])

        original_msg = None
        if resp.get("in_reply_to"):
            original_msg = await self.db.get_message(resp["chat_id"], resp["in_reply_to"])

        contact = None
        if resp.get("target_user_id"):
            contact = await self.db.get_contact(resp["target_user_id"])
        elif original_msg and original_msg.get("sender_id"):
            contact = await self.db.get_contact(original_msg["sender_id"])

        return {
            "group_name": group_name,
            "original_msg": original_msg,
            "contact": contact,
        }

    def _format_feedback(self, emoji: str, title: str, resp: dict, ctx: dict,
                         text: str | None = None, extra: str = "") -> str:
        """Build a detailed feedback message."""
        lines = [f"{emoji} {title}"]
        lines.append("")

        # Type
        rtype = resp.get("response_type", "?")
        type_label = {"value": "reactive", "proactive": "proactive", "dm": "DM"}.get(rtype, rtype)
        lines.append(f"Type: {type_label} | conf: {resp.get('confidence', 0):.2f}")

        # Group
        lines.append(f"Group: {ctx['group_name']}")

        # Original message
        orig = ctx.get("original_msg")
        contact = ctx.get("contact")
        if orig:
            sender = orig.get("sender_name", "?")
            username = contact.get("username") if contact else None
            sender_str = f"{sender} (@{username})" if username else sender
            lines.append(f"Reply to: {sender_str}")
            lines.append(f'"{orig.get("text", "")[:300]}"')
        elif resp.get("response_type") == "dm" and resp.get("target_user_id"):
            name = contact.get("display_name", "?") if contact else "?"
            username = contact.get("username") if contact else None
            target_str = f"{name} (@{username})" if username else name
            lines.append(f"DM to: {target_str}")

        # Our text
        if text:
            lines.append("")
            lines.append(f'Aida: "{text[:500]}"')

        # Timestamp
        now_str = datetime.now(timezone.utc).strftime("%H:%M:%S UTC")
        lines.append("")
        lines.append(f"Time: {now_str}")

        if extra:
            lines.append(extra)

        return "\n".join(lines)

    async def _audit_event(self, resp: dict | None, **fields) -> None:
        audit_id = resp.get("audit_id") if resp else None
        if audit_id:
            await self.db.update_audit_log(audit_id, **fields)

    async def _attempt_delivery(self, response_id: int, feedback_message: Message | None = None):
        resp = await self.db.get_response(response_id)
        if not resp or resp["status"] not in {"approved", "edited", "queued", "sending"}:
            return

        ok, reason = await self._revalidate(resp)
        if not ok:
            if reason == "original_deleted":
                await self.db.update_response_status(
                    response_id,
                    "rejected",
                    send_error=reason,
                    failed_at=_now(),
                )
                await self._audit_event(resp, status="rejected_original_deleted", error=reason)
                ctx = await self._build_context(resp)
                fb = self._format_feedback("\u274c", "Original deleted", resp, ctx,
                                           extra=f"Error: {reason}")
                await self._update_feedback(resp, fb, feedback_message)
                return

            wait_sec = self._backoff_seconds(0, reason)
            await self._queue_response(response_id, resp, reason, retry_increment=False)
            await self._update_feedback(
                resp,
                f"\u23f3 Queued, will send in {wait_sec // 60}m {wait_sec % 60}s ({reason})",
                feedback_message,
            )
            return

        text = resp.get("final_text") or resp.get("edited_text") or resp.get("draft_text")
        await self.db.update_response_status(response_id, "sending")

        # DM responses go to user DM, group responses go to group
        if resp.get("response_type") == "dm" and resp.get("target_user_id"):
            dm_text = resp.get("dm_text") or ""
            if not dm_text:
                log.error("DM response %s has no dm_text (pipeline contract violation); aborting send", response_id)
                await self.db.update_response_status(
                    response_id, "failed", failed_at=_now(), send_error="missing dm_text"
                )
                await self._audit_event(resp, status="aborted", error="missing dm_text")
                ctx = await self._build_context(resp)
                fb = self._format_feedback("❌", "DM aborted", resp, ctx,
                                           extra="missing dm_text")
                await self._update_feedback(resp, fb, feedback_message)
                return
            result = await self.sender.send_dm(resp["target_user_id"], dm_text)
            if result.success:
                log.info("DM sent to user %s", resp["target_user_id"])
            else:
                log.error("DM failed to user %s: %s", resp["target_user_id"], result.error)
        else:
            result = await self.sender.send(resp["chat_id"], text, reply_to=resp["in_reply_to"])

        if result.success:
            sent_at = _now()
            await self.db.update_response_status(
                response_id,
                "sent",
                sent_at=sent_at,
                send_error=None,
            )
            audit_fields = {"status": "sent", "sent_at": sent_at}
            if resp.get("response_type") == "dm":
                audit_fields["final_dm_text"] = resp.get("dm_text") or ""
            else:
                audit_fields["final_text"] = text
            await self._audit_event(resp, **audit_fields)
            await self.db.increment_responses_today(resp["chat_id"])
            if resp.get("in_reply_to"):
                await self.db.mark_responded(resp["chat_id"], resp["in_reply_to"])

            ctx = await self._build_context(resp)
            fb = self._format_feedback("\u2705", "Sent", resp, ctx, text=text)
            await self._update_feedback(resp, fb, feedback_message)
            return

        if result.banned:
            await self.db.update_response_status(
                response_id,
                "failed",
                failed_at=_now(),
                send_error=result.error,
            )
            await self._audit_event(resp, status="banned", error=result.error)
            await self.db.update_group_status(resp["chat_id"], "banned")
            ctx = await self._build_context(resp)
            fb = self._format_feedback("\U0001f6ab", f"BANNED from {ctx['group_name']}!", resp, ctx,
                                       text=text, extra=f"Error: {result.error}")
            await self._update_feedback(resp, fb, feedback_message)
            await self.alert("ERROR", f"Banned from group {ctx['group_name']}: {result.error}")
            return

        error = result.error or "send_failed"
        await self._queue_response(
            response_id,
            resp,
            error,
            retry_increment=True,
            flood_wait_seconds=result.flood_wait_seconds,
        )
        retry_info = f"FloodWait {result.flood_wait_seconds}s" if result.flood_wait_seconds else error
        ctx = await self._build_context(resp)
        fb = self._format_feedback("\u23f3", "Retry queued", resp, ctx,
                                   text=text, extra=f"Reason: {retry_info}")
        await self._update_feedback(resp, fb, feedback_message)

    async def _revalidate(self, resp: dict) -> tuple[bool, str]:
        if self.rate_limiter:
            is_reply = bool(resp.get("in_reply_to"))
            can, reason = await self.rate_limiter.can_respond(resp["chat_id"], is_reply=is_reply)
            if not can:
                return False, reason
        exists_fn = getattr(self.sender, "message_exists", None)
        if exists_fn and not await exists_fn(resp["chat_id"], resp.get("in_reply_to")):
            return False, "original_deleted"
        return True, "ok"

    async def _queue_response(
        self,
        response_id: int,
        resp: dict,
        reason: str,
        retry_increment: bool,
        flood_wait_seconds: int | None = None,
    ):
        retry_count = resp.get("retry_count", 0) + (1 if retry_increment else 0)
        next_attempt = datetime.now(timezone.utc) + timedelta(
            seconds=flood_wait_seconds or self._backoff_seconds(retry_count, reason)
        )
        await self.db.update_response_status(
            response_id,
            "queued",
            failed_at=next_attempt.isoformat(),
            retry_count=retry_count,
            send_error=reason,
        )
        await self._audit_event(resp, status="queued", error=reason)

        approval_message_id = resp.get("approval_message_id")
        if approval_message_id:
            await self._edit_approval_message(
                f"\u23f3 Queued for retry at {next_attempt.strftime('%H:%M:%S UTC')} ({reason})",
                message_id=approval_message_id,
            )

        if retry_count >= 3 and not flood_wait_seconds and not reason.startswith("global_"):
            await self.db.update_response_status(
                response_id,
                "failed",
                failed_at=_now(),
                send_error=reason,
            )
            await self._audit_event(resp, status="failed", error=reason)

    def _seconds_until_retry(self, resp: dict) -> float:
        failed_at = resp.get("failed_at")
        if not failed_at:
            return 0
        try:
            retry_at = datetime.fromisoformat(failed_at).replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            return 0
        return (retry_at - datetime.now(timezone.utc)).total_seconds()

    def _backoff_seconds(self, retry_count: int, reason: str) -> int:
        if reason == "group_daily_limit":
            return 3600
        if reason == "group_delay":
            return self.config["limits"]["min_delay_per_group"]
        return min(300, max(30, 30 * (2 ** max(retry_count - 1, 0))))

    async def _update_feedback(self, resp: dict, text: str, feedback_message: Message | None):
        if feedback_message:
            await feedback_message.edit_text(text)
            return
        approval_message_id = resp.get("approval_message_id")
        if approval_message_id:
            await self._edit_approval_message(text, approval_message_id)

    async def _edit_approval_message(self, text: str, message_id: int):
        try:
            await self.bot.edit_message_text(
                text,
                chat_id=self.chat_id,
                message_id=message_id,
            )
        except Exception:
            log.debug("approval_message_update_failed", exc_info=True)
