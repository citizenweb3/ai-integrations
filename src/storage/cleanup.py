"""Cleanup routines — message retention, counter resets, audit redaction."""

import asyncio
import logging

log = logging.getLogger(__name__)


class CleanupManager:
    def __init__(self, db, contacts, config: dict):
        self.db = db
        self.contacts = contacts
        self.retention_hours = config["database"]["message_retention_hours"]
        self.redaction_days = config["database"]["audit_redaction_days"]

    async def run_hourly(self):
        """Called every hour: clean old messages."""
        deleted = await self.db.cleanup_old_messages(self.retention_hours)
        activated = await self.db.activate_expired_warmups()
        log.info(
            "Cleaned %d messages older than %dh; activated %d groups",
            deleted,
            self.retention_hours,
            activated,
        )

    async def run_daily(self):
        """Called daily at 00:00 UTC: reset counters, redact audit."""
        await self.db.reset_daily_counters()
        log.info("Daily counters reset")
        await self.db.redact_old_audit_logs(self.redaction_days)
        log.info("Audit logs older than %d days redacted", self.redaction_days)
        deleted = await self.db.cleanup_old_filter_logs(self.redaction_days)
        log.info("Deleted %d Router filter logs older than %d days", deleted, self.redaction_days)

    async def run_6h(self):
        """Called every 6 hours: recalculate contact relevance scores."""
        await self.contacts.recalculate_scores()
