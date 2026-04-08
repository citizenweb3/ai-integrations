"""Auto-join groups with anti-ban delays and approval flow."""

import asyncio
import random
import logging
from datetime import datetime, timezone, timedelta
from telethon import TelegramClient
from telethon.tl.functions.channels import JoinChannelRequest
from telethon.errors import FloodWaitError, ChannelPrivateError, InviteRequestSentError

log = logging.getLogger(__name__)


class Joiner:
    def __init__(self, client: TelegramClient, db, config: dict):
        self.client = client
        self.db = db
        self.config = config
        self.max_per_day = config["limits"]["join_groups_per_day"]

    async def join_groups(self, usernames: list[str]) -> list[str]:
        joined = []
        for i, username in enumerate(usernames):
            if i >= self.max_per_day:
                log.info("Reached daily join limit (%d)", self.max_per_day)
                break

            try:
                if i > 0:
                    delay = random.uniform(60, 180)
                    log.info("Waiting %.0fs before next join...", delay)
                    await asyncio.sleep(delay)

                entity = await self.client.get_entity(username)
                await self.client(JoinChannelRequest(entity))

                title = getattr(entity, "title", username)
                member_count = getattr(entity, "participants_count", None)

                hours = random.uniform(
                    self.config["limits"]["warmup_hours_min"],
                    self.config["limits"]["warmup_hours_max"],
                )
                warmup_until = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()

                await self.db.upsert_group(
                    entity.id, title, username, member_count,
                    warmup_until=warmup_until,
                )
                log.info("Joined @%s (%s, %s members, warmup %.1fh)",
                         username, title, member_count or "?", hours)
                joined.append(username)

            except FloodWaitError as e:
                log.warning("FloodWait: need to wait %ds. Stopping joins.", e.seconds)
                break
            except ChannelPrivateError:
                log.warning("@%s is private, skipping", username)
            except InviteRequestSentError:
                log.info("@%s requires approval, request sent", username)
            except Exception as e:
                log.error("Failed to join @%s: %s", username, e)

        return joined

    async def join_wave(self, wave_index: int) -> list[str]:
        waves = self.config["groups"]["waves"]
        if wave_index >= len(waves):
            log.info("All waves completed")
            return []
        wave = waves[wave_index]
        log.info("Starting wave %d: %d groups", wave_index + 1, len(wave))
        return await self.join_groups(wave)
