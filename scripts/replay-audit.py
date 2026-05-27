#!/usr/bin/env python3
"""Replay historical audit-log prompts through the new Gemini responder and diff
decisions against the stored (Claude-era) ones.

Migration validation harness (design Topic 7). Makes REAL Vertex calls and is a
DRY RUN: it only runs Phase-1 generation and compares decisions — it never sends
a message. Run manually, not in CI.

Usage:
    python scripts/replay-audit.py [N]      # N = number of recent rows (default 20)

Reads GOOGLE_CLOUD_PROJECT/LOCATION + ADC from the environment (load_config
mirrors .env into os.environ).
"""

import asyncio
import json
import sqlite3
import sys

from src.config import load_config
from src.ai.responder import Responder


async def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    config = load_config()
    responder = Responder(config)  # fail-fasts if Vertex env is missing

    conn = sqlite3.connect(config["database"]["path"])
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, claude_prompt, claude_parsed FROM audit_log "
        "WHERE claude_prompt IS NOT NULL AND claude_parsed IS NOT NULL "
        "ORDER BY created_at DESC LIMIT ?",
        (n,),
    ).fetchall()
    conn.close()

    if not rows:
        print("no replayable audit rows found")
        return

    print(f"{'audit_id':36}  {'old_act':8} {'old_cf':>6}  {'new_act':8} {'new_cf':>6}  match")
    print("-" * 84)
    agree = 0
    for r in rows:
        try:
            old = json.loads(r["claude_parsed"]) if r["claude_parsed"] else {}
        except json.JSONDecodeError:
            old = {}
        old_act = str(old.get("action", "?"))
        old_cf = float(old.get("confidence", 0) or 0)

        parsed, _tool_calls = await responder.generate(r["claude_prompt"])
        if parsed is None:
            new_act, new_cf = f"ERR:{responder.last_error}", 0.0
        else:
            new_act = str(parsed.get("action", "?"))
            new_cf = float(parsed.get("confidence", 0) or 0)

        match = old_act == new_act[:8]
        agree += int(match)
        print(f"{str(r['id']):36}  {old_act:8} {old_cf:>6.2f}  {new_act:8} {new_cf:>6.2f}  {'OK' if match else 'XX'}")

    print("-" * 84)
    print(f"action agreement: {agree}/{len(rows)}")
    print("Note: tune the confidence threshold (>=0.9) if the new confidence "
          "distribution shifted vs Claude. Then run the cutover in mode: approval "
          "(human approves every draft pre-send) before any autonomous sending.")


if __name__ == "__main__":
    asyncio.run(main())
