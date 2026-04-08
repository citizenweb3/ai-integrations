#!/usr/bin/env python3
"""Query ValidatorInfo PostgreSQL. Usage: python tools/query-db.py "SELECT ..." """
import sys, os, json, asyncio

async def main():
    import asyncpg
    sql = sys.argv[1] if len(sys.argv) > 1 else ""
    if not sql:
        print("Usage: query-db.py 'SELECT ...'")
        sys.exit(1)

    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn:
        print(json.dumps({"error": "DATABASE_URL not set"}))
        sys.exit(1)

    try:
        conn = await asyncpg.connect(dsn, timeout=5)
        rows = await asyncio.wait_for(conn.fetch(sql), timeout=5)
        await conn.close()
        print(json.dumps([dict(r) for r in rows], indent=2, default=str))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

asyncio.run(main())
