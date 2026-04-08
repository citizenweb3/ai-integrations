"""Send messages to Telegram groups with human-like typing delay."""

import asyncio
import random
import logging
from dataclasses import dataclass
from telethon import TelegramClient
from telethon.errors import FloodWaitError, ChatWriteForbiddenError, UserBannedInChannelError

log = logging.getLogger(__name__)


@dataclass
class SendResult:
    success: bool
    message_id: int | None = None
    error: str | None = None
    flood_wait_seconds: int | None = None
    banned: bool = False


class Sender:
    def __init__(self, client: TelegramClient, config: dict):
        self.client = client
        self.config = config

    async def send(self, chat_id: int, text: str, reply_to: int | None = None) -> SendResult:
        """Send message with typing delay + jitter. Returns SendResult."""

        # Typing simulation
        typing_min = self.config["limits"]["typing_duration_min"]
        typing_max = self.config["limits"]["typing_duration_max"]
        delay = random.uniform(typing_min, typing_max)

        try:
            async with self.client.action(chat_id, "typing"):
                await asyncio.sleep(delay)

            msg = await self.client.send_message(chat_id, text, reply_to=reply_to)
            log.info(f"Sent to {chat_id}: {text[:80]}")
            return SendResult(success=True, message_id=msg.id)

        except FloodWaitError as e:
            log.warning(f"FloodWait: {e.seconds}s for chat {chat_id}")
            return SendResult(success=False, error=f"FloodWait({e.seconds})", flood_wait_seconds=e.seconds)

        except (ChatWriteForbiddenError, UserBannedInChannelError) as e:
            log.error(f"Banned/forbidden in chat {chat_id}: {e}")
            return SendResult(success=False, error=str(e), banned=True)

        except Exception as e:
            log.error(f"Send failed for chat {chat_id}: {e}")
            return SendResult(success=False, error=str(e))

    async def send_dm(self, user_id: int, text: str) -> SendResult:
        """Send a direct message to a user. No typing delay for DMs."""
        try:
            msg = await self.client.send_message(user_id, text)
            log.info(f"DM sent to {user_id}: {text[:80]}")
            return SendResult(success=True, message_id=msg.id)
        except FloodWaitError as e:
            log.warning(f"FloodWait on DM to {user_id}: {e.seconds}s")
            return SendResult(success=False, error=f"FloodWait({e.seconds})", flood_wait_seconds=e.seconds)
        except Exception as e:
            log.error(f"DM failed to {user_id}: {e}")
            return SendResult(success=False, error=str(e))

    async def message_exists(self, chat_id: int, message_id: int | None) -> bool:
        if not message_id:
            return True
        try:
            msg = await self.client.get_messages(chat_id, ids=message_id)
            return bool(msg)
        except Exception as e:
            log.warning("Failed to verify original message %s in %s: %s", message_id, chat_id, e)
            return False
