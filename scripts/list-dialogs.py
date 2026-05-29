#!/usr/bin/env python3
"""One-off: list all dialogs (groups/channels/DMs) of the Aida user account.

Reads API creds + session from .env, connects via Telethon, prints
chat_id + title + type. Use to discover APPROVAL_CHAT_ID for the test
group when @BotFather privacy mode blocks getUpdates discovery.

Usage:
    .venv/bin/python scripts/list-dialogs.py
"""
import asyncio
import os
from pathlib import Path

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.types import Channel, Chat, User

_env_path = Path(__file__).parent.parent / ".env"
if _env_path.exists():
    for _line in _env_path.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

api_id = int(os.environ.get("TELEGRAM_API_ID", 0))
api_hash = os.environ.get("TELEGRAM_API_HASH", "")
session_str = os.environ.get("TELEGRAM_SESSION", "")

if not all([api_id, api_hash, session_str]):
    print("Error: TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION must be set")
    raise SystemExit(1)


async def main() -> None:
    async with TelegramClient(StringSession(session_str), api_id, api_hash) as client:
        async for dialog in client.iter_dialogs():
            entity = dialog.entity
            if isinstance(entity, User):
                kind = "DM"
            elif isinstance(entity, Channel):
                kind = "channel" if entity.broadcast else "supergroup"
            elif isinstance(entity, Chat):
                kind = "group"
            else:
                kind = type(entity).__name__
            print(f"{dialog.id:>15}  {kind:<12}  {dialog.name}")


if __name__ == "__main__":
    asyncio.run(main())
