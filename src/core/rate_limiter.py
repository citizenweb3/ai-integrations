"""Rate limiter — anti-ban checks before responding."""

import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)


class RateLimiter:
    def __init__(self, db, config: dict):
        self.db = db
        self.limits = config["limits"]

    async def can_respond(self, chat_id: int, is_reply: bool = False) -> tuple[bool, str]:
        # 1. Group exists?
        group = await self.db.get_group(chat_id)
        if not group:
            return False, "group_not_found"

        # 2. Warmup passed? Auto-transition to active
        if group.get("warmup_until"):
            try:
                warmup = datetime.fromisoformat(group["warmup_until"]).replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) < warmup:
                    return False, "warmup_active"
                if group["status"] == "warmup":
                    await self.db.update_group_status(chat_id, "active")
                    group["status"] = "active"
            except (ValueError, TypeError):
                pass

        # 3. Status active?
        if group["status"] != "active":
            return False, f"group_status_{group['status']}"

        # 4. Per-group daily limit
        group_today = await self.db.count_responses_today(chat_id)
        if group_today >= self.limits["messages_per_group_per_day"]:
            return False, "group_daily_limit"

        # 5. Per-group delay (skip for replies — continuing a conversation)
        if not is_reply and group.get("last_response_at"):
            try:
                last = datetime.fromisoformat(group["last_response_at"]).replace(tzinfo=timezone.utc)
                elapsed = (datetime.now(timezone.utc) - last).total_seconds()
                if elapsed < self.limits["min_delay_per_group"]:
                    return False, "group_delay"
            except (ValueError, TypeError):
                pass

        return True, "ok"
