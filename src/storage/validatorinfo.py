"""ValidatorInfo PostgreSQL — startup health check only.

Real queries are made by Claude via src/tools/query-db.py.
"""

import logging

log = logging.getLogger(__name__)


class ValidatorInfoAdapter:
    def __init__(self, config: dict):
        self._dsn = config["validatorinfo"]["database_url"]
        self._timeout = config["validatorinfo_db"]["query_timeout_seconds"]

    async def start(self):
        """Verify connection at startup."""
        if not self._dsn:
            log.warning("DATABASE_URL not set — ValidatorInfo DB disabled")
            return

    async def close(self):
        pass

    async def health_check(self) -> bool:
        if not self._dsn:
            return False
        try:
            import asyncpg
            conn = await asyncpg.connect(self._dsn, timeout=self._timeout)
            await conn.fetchval("SELECT 1")
            await conn.close()
            log.info("ValidatorInfo DB connected")
            return True
        except Exception as e:
            log.error("ValidatorInfo DB health check failed: %s", e)
            return False
