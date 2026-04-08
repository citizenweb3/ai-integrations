"""Healthcheck script — checks if agent is alive by verifying heartbeat file."""
import sys
import time
from pathlib import Path

HEARTBEAT_FILE = Path("/app/data/.heartbeat")
MAX_AGE_SECONDS = 120  # 2 minutes without heartbeat = unhealthy

if not HEARTBEAT_FILE.exists():
    print("UNHEALTHY: no heartbeat file")
    sys.exit(1)

age = time.time() - HEARTBEAT_FILE.stat().st_mtime
if age > MAX_AGE_SECONDS:
    print(f"UNHEALTHY: heartbeat is {int(age)}s old")
    sys.exit(1)

print(f"OK: heartbeat {int(age)}s ago")
sys.exit(0)
