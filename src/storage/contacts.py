"""Contact manager — track and score users from monitored groups."""

import json
import logging

log = logging.getLogger(__name__)


class ContactManager:
    def __init__(self, db):
        self.db = db

    async def process_message(self, sender_id: int, username: str | None,
                               display_name: str, chat_id: int,
                               has_topic: bool = False, topic_name: str | None = None):
        """Update contact from an incoming message."""
        await self.db.upsert_contact(sender_id, username, display_name)
        await self.db.update_contact_activity(
            sender_id, chat_id, has_topic=has_topic, topic_name=topic_name
        )

    async def recalculate_scores(self):
        """Batch recalculate relevance_score for all contacts."""
        await self.db.update_relevance_scores()
        log.info("Relevance scores recalculated")

    async def forget(self, user_id: int):
        """Delete contact and redact from audit_log."""
        await self.db.redact_audit_logs_for_sender(user_id)
        await self.db.redact_filter_logs_for_sender(user_id)
        await self.db.delete_contact(user_id)
        log.info("Contact %s deleted and linked payload redacted", user_id)

    async def get_top(self, limit: int = 50) -> list[dict]:
        """Get top contacts by relevance score."""
        return await self.db.get_top_contacts(limit)
