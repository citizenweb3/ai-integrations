#!/usr/bin/env python3
"""Generate Telethon string session.

Usage:
    docker compose run --rm tg-growth-agent python scripts/generate-session.py
"""
import os
import sys
from pathlib import Path
from telethon.sync import TelegramClient
from telethon.sessions import StringSession

# Load .env for local runs
_env_path = Path(__file__).parent.parent / ".env"
if _env_path.exists():
    for _line in _env_path.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

api_id = int(os.environ.get("TELEGRAM_API_ID", 0))
api_hash = os.environ.get("TELEGRAM_API_HASH", "")

if not api_id or not api_hash:
    print("Error: TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env")
    exit(1)

print("Generating Telethon string session...")
print("You will be asked for your phone number and SMS code.\n")

client = TelegramClient(StringSession(), api_id, api_hash)
client.start()
session_string = client.session.save()
client.disconnect()

print("\n✅ Done. Add this line to your .env file:\n")
print(f"TELEGRAM_SESSION={session_string}\n")
