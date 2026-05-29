"""Telegram Growth Agent — entry point.

Starts Telethon (user account) + aiogram (bot) + cron loops in one asyncio event loop.
"""

import asyncio
import logging
import random
import signal
from datetime import datetime, timezone, timedelta
from os import environ
from pathlib import Path
from telethon import TelegramClient

from src.config import load_config
from src.ai.gemini_client import assert_vertex_env
from src.storage.db import Database
from src.ai.rag import RAGClient
from src.ai.llm_router import LLMRouter
from src.storage.validatorinfo import ValidatorInfoAdapter
from src.ai.responder import Responder
from src.ai.tool_catalog import build_catalog_section
from src.core.rate_limiter import RateLimiter
from src.telegram.sender import Sender
from src.storage.contacts import ContactManager
from src.storage.cleanup import CleanupManager
from src.telegram.listener import Listener
from src.telegram.approval import ApprovalBot
from src.ai.proactive import ProactiveScanner
from src.telegram.joiner import Joiner

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
# Verbose ADK / GenAI logging for the smoke debug session — see
# .tasks/2026-05-28-aida-tool-retry-loop.md (T11). Turn back to INFO
# once the verification loop is understood.
logging.getLogger("google.adk").setLevel(logging.DEBUG)
logging.getLogger("google_adk").setLevel(logging.DEBUG)
logging.getLogger("google_genai").setLevel(logging.DEBUG)
log = logging.getLogger("agent")


async def main():
    config = load_config()

    # 0. Vertex-only fail-fast before any side effects (DB/Telegram). Requires
    #    GOOGLE_CLOUD_PROJECT/LOCATION + ADC, refuses GOOGLE_API_KEY.
    assert_vertex_env()

    # 1. Database
    db = Database(config["database"]["path"])
    await db.connect()
    log.info("Database connected (WAL mode): %s", config["database"]["path"])

    # 2. Telegram client (user account via string session)
    from telethon.sessions import StringSession
    session_string = config["telegram"].get("session", "")
    if not session_string:
        log.critical("TELEGRAM_SESSION not set. Run: docker compose run --rm tg-growth-agent python scripts/generate-session.py")
        return
    client = TelegramClient(
        StringSession(session_string),
        config["telegram"]["api_id"],
        config["telegram"]["api_hash"],
    )
    await client.start()
    me = await client.get_me()
    log.info("Logged in as: %s (@%s, id=%d)", me.first_name, me.username, me.id)

    # 3. Scan joined groups (real joined_at from Telegram API)
    await _scan_groups(client, db, config)

    # 4. External services (with health check)
    rag = RAGClient(config)
    await rag.start()
    rag_ok = await rag.health_check()
    log.info("RAG API: %s", "connected" if rag_ok else "unavailable (degraded)")

    vi = ValidatorInfoAdapter(config)
    await vi.start()
    vi_ok = await vi.health_check()
    log.info("ValidatorInfo DB: %s", "connected" if vi_ok else "unavailable (degraded)")

    # 5. Core services
    # Build tool catalog markdown (L1: hand-written semantics + live schema
    # overlay). Degraded mode (DB unreachable) → catalog renders the schema
    # block as "unavailable"; the agent keeps running.
    try:
        catalog_section = await build_catalog_section(
            dsn=config["validatorinfo"].get("database_url"),
        )
        log.info("Tool catalog built (%d chars)", len(catalog_section))
    except Exception as e:
        log.warning("Tool catalog build failed: %s — running without catalog", e)
        catalog_section = None
    responder = Responder(config, catalog_section=catalog_section)
    sender = Sender(client, config)
    rate_limiter = RateLimiter(db, config)
    contacts = ContactManager(db)
    llm_router = LLMRouter(config)
    await llm_router.start()

    # 6. Approval bot (aiogram)
    approval = ApprovalBot(db, sender, rate_limiter, contacts, config)
    await approval.start()

    # 7. Alert on startup issues
    if not rag_ok:
        await approval.alert("WARNING", "RAG API unavailable at startup. Agent works without podcast data.")
    if not vi_ok:
        await approval.alert("WARNING", "ValidatorInfo DB unavailable at startup. Agent works without on-chain data.")
    log.info("Approval bot started")

    # 7. Listener
    listener = Listener(
        client, db, responder, rag, vi,
        rate_limiter, contacts, approval, config,
        llm_router=llm_router,
    )
    await listener.start()

    # 8. Proactive scanner
    proactive = ProactiveScanner(db, responder, rag, vi, rate_limiter, approval, config, llm_router=llm_router)

    # 9. Cleanup manager
    cleanup = CleanupManager(db, contacts, config)

    # 10. Startup reconciliation
    await _reconcile_pending(db)

    # 11. Stats
    stats = await db.stats()
    log.info("Stats: %s", stats)
    log.info("Agent running — Telethon + aiogram + proactive + cleanup")

    # 12. Cron loops
    cron_tasks = []

    async def _loop(name, coro, interval_sec):
        while True:
            await asyncio.sleep(interval_sec)
            try:
                await coro()
            except Exception as e:
                log.error("%s error: %s", name, e)

    async def _heartbeat():
        Path("data/.heartbeat").touch()

    async def _tg_heartbeat():
        """Check connections and send status to admin every 3 hours."""
        rag_status = await rag.health_check()
        vi_status = await vi.health_check()
        current_stats = await db.stats()
        lines = [
            f"💓 Heartbeat — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
            f"RAG API: {'✅' if rag_status else '❌ unavailable'}",
            f"ValidatorInfo DB: {'✅' if vi_status else '❌ unavailable'}",
            f"Groups: {current_stats.get('groups', '?')} | Messages: {current_stats.get('messages', '?')}",
            f"Responses: {current_stats.get('responses_total', '?')} total / {current_stats.get('responses_sent_today', '?')} today / {current_stats.get('responses_pending', '?')} pending",
        ]
        level = "INFO" if (rag_status and vi_status) else "WARNING"
        await approval.alert(level, "\n".join(lines))
        log.info("tg_heartbeat sent (rag=%s vi=%s)", rag_status, vi_status)

    # Send heartbeat immediately on startup
    try:
        await _tg_heartbeat()
    except Exception as e:
        log.error("startup heartbeat error: %s", e)

    cron_tasks.append(asyncio.create_task(_loop("heartbeat", _heartbeat, 30)))
    cron_tasks.append(asyncio.create_task(_loop("tg_heartbeat", _tg_heartbeat, 10800)))  # every 3h
    cron_tasks.append(asyncio.create_task(_loop("proactive", proactive.run_cycle, config["proactive"]["interval_minutes"] * 60)))
    cron_tasks.append(asyncio.create_task(_loop("queue_retry", approval.process_queue, 30)))
    cron_tasks.append(asyncio.create_task(_loop("cleanup_hourly", cleanup.run_hourly, 3600)))
    cron_tasks.append(asyncio.create_task(_loop("cleanup_daily", cleanup.run_daily, 86400)))
    cron_tasks.append(asyncio.create_task(_loop("relevance_recalc", cleanup.run_6h, 21600)))

    # 13. Graceful shutdown
    stop_event = asyncio.Event()

    def shutdown(sig, frame):
        log.info("Received %s, shutting down...", signal.Signals(sig).name)
        stop_event.set()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    await stop_event.wait()

    # Cleanup
    log.info("Stopping...")
    for t in cron_tasks:
        t.cancel()
    await asyncio.gather(*cron_tasks, return_exceptions=True)
    await approval.stop()
    await llm_router.close()
    await rag.close()
    await vi.close()
    await db.close()
    await client.disconnect()
    log.info("Agent stopped")


async def _scan_groups(client: TelegramClient, db: Database, config: dict):
    """Scan all joined groups on startup, register with real joined_at."""
    from telethon.tl.functions.channels import GetParticipantRequest
    from telethon.tl.types import Channel

    me = await client.get_me()
    dialogs = await client.get_dialogs()
    registered = 0

    for dialog in dialogs:
        if not (dialog.is_group or dialog.is_channel):
            continue

        chat = dialog.entity
        chat_id = dialog.id
        existing = await db.get_group(chat_id)
        if existing:
            continue

        # Get real join date from Telegram API
        joined_at = None
        if isinstance(chat, Channel):
            # Supergroups and channels — GetParticipantRequest works
            try:
                result = await client(GetParticipantRequest(chat, me))
                joined_at = result.participant.date
            except Exception as e:
                log.debug("GetParticipantRequest failed for %s: %s", getattr(chat, "title", chat_id), e)

        if joined_at is None:
            # Regular groups or failed request — use chat creation date or dialog date
            joined_at = getattr(chat, "date", None) or dialog.date or datetime.now(timezone.utc)

        # Ensure timezone aware
        if joined_at.tzinfo is None:
            joined_at = joined_at.replace(tzinfo=timezone.utc)

        hours = random.uniform(
            config["limits"]["warmup_hours_min"],
            config["limits"]["warmup_hours_max"],
        )
        warmup_until = joined_at + timedelta(hours=hours)

        # If warmup already passed — will be auto-activated by rate_limiter
        await db.upsert_group(
            chat_id,
            getattr(chat, "title", None),
            getattr(chat, "username", None),
            getattr(chat, "participants_count", None),
            warmup_until=warmup_until.isoformat(),
            joined_at=joined_at.isoformat(),
        )
        status = "active (warmup passed)" if warmup_until < datetime.now(timezone.utc) else f"warmup until {warmup_until.strftime('%H:%M')}"
        registered += 1
        log.info("Scanned group: %s — %s", getattr(chat, "title", chat_id), status)

    log.info("Group scan complete: %d new groups registered", registered)


async def _reconcile_pending(db: Database):
    """Startup reconciliation: sending → queued, expired pending."""
    pending = await db.get_pending_responses()
    for r in pending:
        if r["status"] == "sending":
            await db.update_response_status(r["id"], "queued")
            log.info("Reconciled response #%d: sending → queued", r["id"])
        elif r["status"] == "pending_approval":
            # Check TTL — if too old, expire
            from datetime import datetime, timezone
            try:
                created = datetime.fromisoformat(r["created_at"]).replace(tzinfo=timezone.utc)
                age = (datetime.now(timezone.utc) - created).total_seconds()
                ttl_seconds = 7200 if r.get("response_type") == "proactive" else 1800
                if age > ttl_seconds:
                    await db.update_response_status(r["id"], "expired",
                                                     expired_at=datetime.now(timezone.utc).isoformat())
                    log.info("Reconciled response #%d: pending → expired (age %.0fs)", r["id"], age)
            except (ValueError, TypeError):
                pass


if __name__ == "__main__":
    asyncio.run(main())
