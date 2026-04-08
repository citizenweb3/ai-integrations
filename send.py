"""Quick send — one-off message to a group.

Usage: python send.py <chat_name_or_id> "message" [--reply-to MSG_ID]
"""

import asyncio
import sys
import random
from telethon import TelegramClient
from src.config import load_config


async def main():
    if len(sys.argv) < 3:
        print("Usage: python send.py <chat> \"message\" [--reply-to MSG_ID]")
        sys.exit(1)

    chat = sys.argv[1]
    text = sys.argv[2]
    reply_to = None
    if "--reply-to" in sys.argv:
        idx = sys.argv.index("--reply-to")
        reply_to = int(sys.argv[idx + 1])

    config = load_config()
    client = TelegramClient(
        "data/session",
        config["telegram"]["api_id"],
        config["telegram"]["api_hash"],
    )
    await client.start()

    # Resolve chat
    entity = await client.get_entity(chat)
    print(f"Sending to: {getattr(entity, 'title', chat)}")

    # Typing simulation
    delay = random.uniform(3, 8)
    print(f"Typing for {delay:.1f}s...")
    async with client.action(entity, "typing"):
        await asyncio.sleep(delay)

    msg = await client.send_message(entity, text, reply_to=reply_to)
    print(f"Sent (msg_id={msg.id}): {text}")

    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
