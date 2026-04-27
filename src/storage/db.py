"""SQLite database operations for the growth agent."""

import json
import aiosqlite
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER UNIQUE NOT NULL,
    name TEXT,
    username TEXT,
    language TEXT DEFAULT 'mixed',
    member_count INTEGER,
    joined_at TIMESTAMP,
    warmup_until TIMESTAMP,
    status TEXT DEFAULT 'warmup',
    last_response_at TIMESTAMP,
    responses_today INTEGER DEFAULT 0,
    responses_today_reset_at TIMESTAMP,
    topic_relevance REAL DEFAULT 0.5,
    admin_strictness TEXT DEFAULT 'unknown',
    link_tolerance TEXT DEFAULT 'unknown',
    last_incident_at TIMESTAMP,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    sender_id INTEGER,
    sender_name TEXT,
    text TEXT,
    topic TEXT,
    reply_to_message_id INTEGER,
    responded BOOLEAN DEFAULT FALSE,
    timestamp TIMESTAMP,
    UNIQUE(chat_id, message_id)
);

CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    in_reply_to INTEGER,
    draft_text TEXT,
    edited_text TEXT,
    final_text TEXT,
    response_type TEXT,
    confidence REAL,
    reason TEXT,
    rag_results TEXT,
    db_data TEXT,
    model_name TEXT,
    prompt_hash TEXT,
    status TEXT DEFAULT 'candidate',
    created_at TIMESTAMP,
    approved_at TIMESTAMP,
    approved_by TEXT,
    edited_at TIMESTAMP,
    sent_at TIMESTAMP,
    expired_at TIMESTAMP,
    failed_at TIMESTAMP,
    send_error TEXT,
    superseded_by INTEGER,
    retry_count INTEGER DEFAULT 0,
    contains_link BOOLEAN DEFAULT FALSE,
    target_user_id INTEGER,
    dm_text TEXT,
    approval_message_id INTEGER,
    audit_id TEXT
);

CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    display_name TEXT,
    first_seen_at TIMESTAMP,
    last_seen_at TIMESTAMP,
    message_count INTEGER DEFAULT 0,
    staking_message_count INTEGER DEFAULT 0,
    topics TEXT DEFAULT '{}',
    groups_active_in TEXT DEFAULT '[]',
    groups_in_common INTEGER DEFAULT 0,
    relevance_score REAL DEFAULT 0.0,
    relevance_updated_at TIMESTAMP,
    times_replied_to INTEGER DEFAULT 0,
    last_replied_to_at TIMESTAMP,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    chat_id INTEGER NOT NULL,
    sender_id INTEGER,
    message_id INTEGER,
    status TEXT,
    original_text TEXT,
    topic TEXT,
    rag_query TEXT,
    rag_results TEXT,
    claude_prompt TEXT,
    claude_raw TEXT,
    claude_parsed TEXT,
    claude_duration_ms INTEGER,
    approval_decision TEXT,
    approval_edit TEXT,
    final_text TEXT,
    final_dm_text TEXT,
    sent_at TEXT,
    error TEXT
);

CREATE TABLE IF NOT EXISTS tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id TEXT NOT NULL REFERENCES audit_log(id) ON DELETE CASCADE,
    phase TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    tool_name TEXT NOT NULL,
    tool_input TEXT,
    tool_output TEXT,
    output_truncated INTEGER DEFAULT 0,
    latency_ms INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_filter_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    chat_id INTEGER NOT NULL,
    message_id INTEGER,
    sender_id INTEGER,
    sender_name TEXT,
    decision TEXT NOT NULL,
    reason TEXT,
    latency_ms INTEGER,
    attempts INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS enforce_single_pending
BEFORE INSERT ON responses
WHEN NEW.status IN ('candidate', 'pending_approval', 'queued', 'sending')
BEGIN
    UPDATE responses
    SET status = 'superseded', expired_at = strftime('%Y-%m-%dT%H:%M:%S', 'now')
    WHERE chat_id = NEW.chat_id
      AND in_reply_to = NEW.in_reply_to
      AND in_reply_to IS NOT NULL
      AND status IN ('candidate', 'pending_approval', 'queued');
END;

"""

INDEX_SCHEMA = """
CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic);
CREATE INDEX IF NOT EXISTS idx_responses_status ON responses(status);
CREATE INDEX IF NOT EXISTS idx_responses_chat_status ON responses(chat_id, status);
CREATE INDEX IF NOT EXISTS idx_responses_created ON responses(created_at);
CREATE INDEX IF NOT EXISTS idx_contacts_relevance ON contacts(relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_last_seen ON contacts(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_audit_chat ON audit_log(chat_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_status ON audit_log(status);
CREATE INDEX IF NOT EXISTS idx_tool_calls_audit ON tool_calls(audit_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_phase ON tool_calls(audit_id, phase, sequence);
CREATE INDEX IF NOT EXISTS idx_llm_filter_log_created ON llm_filter_log(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_filter_log_message ON llm_filter_log(chat_id, message_id);
CREATE INDEX IF NOT EXISTS idx_llm_filter_log_sender ON llm_filter_log(sender_id);
"""

COLUMN_MIGRATIONS = {
    "groups": [
        ("warmup_until", "TIMESTAMP"),
        ("responses_today_reset_at", "TIMESTAMP"),
        ("topic_relevance", "REAL DEFAULT 0.5"),
        ("admin_strictness", "TEXT DEFAULT 'unknown'"),
        ("link_tolerance", "TEXT DEFAULT 'unknown'"),
        ("last_incident_at", "TIMESTAMP"),
        ("notes", "TEXT"),
    ],
    "messages": [
        ("reply_to_message_id", "INTEGER"),
        ("responded", "BOOLEAN DEFAULT FALSE"),
    ],
    "responses": [
        ("draft_text", "TEXT"),
        ("edited_text", "TEXT"),
        ("final_text", "TEXT"),
        ("reason", "TEXT"),
        ("rag_results", "TEXT"),
        ("db_data", "TEXT"),
        ("model_name", "TEXT"),
        ("prompt_hash", "TEXT"),
        ("approved_at", "TIMESTAMP"),
        ("approved_by", "TEXT"),
        ("edited_at", "TIMESTAMP"),
        ("expired_at", "TIMESTAMP"),
        ("failed_at", "TIMESTAMP"),
        ("send_error", "TEXT"),
        ("superseded_by", "INTEGER"),
        ("retry_count", "INTEGER DEFAULT 0"),
        ("contains_link", "BOOLEAN DEFAULT FALSE"),
        ("target_user_id", "INTEGER"),
        ("dm_text", "TEXT"),
        ("approval_message_id", "INTEGER"),
        ("audit_id", "TEXT"),
    ],
    "contacts": [
        ("display_name", "TEXT"),
        ("first_seen_at", "TIMESTAMP"),
        ("last_seen_at", "TIMESTAMP"),
        ("message_count", "INTEGER DEFAULT 0"),
        ("staking_message_count", "INTEGER DEFAULT 0"),
        ("topics", "TEXT DEFAULT '{}'"),
        ("groups_active_in", "TEXT DEFAULT '[]'"),
        ("relevance_updated_at", "TIMESTAMP"),
        ("times_replied_to", "INTEGER DEFAULT 0"),
        ("last_replied_to_at", "TIMESTAMP"),
        ("notes", "TEXT"),
    ],
    "audit_log": [
        ("sender_id", "INTEGER"),
        ("status", "TEXT"),
        ("original_text", "TEXT"),
        ("topic", "TEXT"),
        ("rag_query", "TEXT"),
        ("rag_results", "TEXT"),
        ("claude_prompt", "TEXT"),
        ("claude_raw", "TEXT"),
        ("claude_parsed", "TEXT"),
        ("claude_duration_ms", "INTEGER"),
        ("approval_decision", "TEXT"),
        ("approval_edit", "TEXT"),
        ("final_text", "TEXT"),
        ("final_dm_text", "TEXT"),
        ("sent_at", "TEXT"),
        ("error", "TEXT"),
    ],
}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


class Database:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._db: aiosqlite.Connection | None = None

    async def connect(self):
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._db = await aiosqlite.connect(self.db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.execute("PRAGMA journal_mode=WAL")
        await self._db.execute("PRAGMA busy_timeout=10000")
        await self._db.execute("PRAGMA foreign_keys=ON")
        await self._db.executescript(SCHEMA)
        await self._apply_migrations()
        await self._db.executescript(INDEX_SCHEMA)
        await self._db.commit()

    async def close(self):
        if self._db:
            await self._db.close()

    @property
    def db(self) -> aiosqlite.Connection:
        if not self._db:
            raise RuntimeError("Database not connected")
        return self._db

    async def _apply_migrations(self):
        for table, columns in COLUMN_MIGRATIONS.items():
            async with self.db.execute(f"PRAGMA table_info({table})") as cur:
                existing = {row[1] for row in await cur.fetchall()}
            for column, ddl in columns:
                if column not in existing:
                    await self.db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")

    # ── Groups ──────────────────────────────────────────────

    async def upsert_group(
        self,
        chat_id: int,
        name: str | None,
        username: str | None,
        member_count: int | None = None,
        warmup_until: str | None = None,
        joined_at: str | None = None,
    ):
        await self.db.execute(
            """INSERT INTO groups (chat_id, name, username, member_count, warmup_until, joined_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(chat_id) DO UPDATE SET
                 name = COALESCE(excluded.name, groups.name),
                 username = COALESCE(excluded.username, groups.username),
                 member_count = COALESCE(excluded.member_count, groups.member_count)""",
            (chat_id, name, username, member_count, warmup_until, joined_at or _now()),
        )
        await self.db.commit()

    async def get_group(self, chat_id: int) -> dict | None:
        async with self.db.execute(
            "SELECT * FROM groups WHERE chat_id = ?", (chat_id,)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None

    async def get_active_groups(self) -> list[dict]:
        async with self.db.execute(
            "SELECT * FROM groups WHERE status IN ('warmup', 'active')"
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]

    async def get_groups_by_status(self, *statuses: str) -> list[dict]:
        if not statuses:
            return []
        placeholders = ", ".join("?" for _ in statuses)
        async with self.db.execute(
            f"SELECT * FROM groups WHERE status IN ({placeholders})", statuses
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]

    async def update_group_status(self, chat_id: int, status: str):
        await self.db.execute(
            "UPDATE groups SET status = ? WHERE chat_id = ?", (status, chat_id)
        )
        await self.db.commit()

    async def update_group_field(self, chat_id: int, field: str, value):
        allowed = {
            "language", "member_count", "warmup_until", "status",
            "last_response_at", "topic_relevance", "admin_strictness",
            "link_tolerance", "last_incident_at", "notes",
            "responses_today", "responses_today_reset_at",
        }
        if field not in allowed:
            raise ValueError(f"Field {field!r} is not updatable")
        await self.db.execute(
            f"UPDATE groups SET {field} = ? WHERE chat_id = ?", (value, chat_id)
        )
        await self.db.commit()

    async def increment_responses_today(self, chat_id: int):
        await self.db.execute(
            """UPDATE groups
               SET responses_today = responses_today + 1,
                   last_response_at = ?
               WHERE chat_id = ?""",
            (_now(), chat_id),
        )
        await self.db.commit()

    async def reset_daily_counters(self):
        await self.db.execute(
            """UPDATE groups
               SET responses_today = 0, responses_today_reset_at = ?
               WHERE responses_today_reset_at IS NULL
                  OR date(responses_today_reset_at) < date('now')""",
            (_now(),),
        )
        await self.db.commit()

    async def activate_expired_warmups(self) -> int:
        cursor = await self.db.execute(
            """UPDATE groups
               SET status = 'active'
               WHERE status = 'warmup'
                 AND warmup_until IS NOT NULL
                 AND datetime(warmup_until) <= datetime('now')"""
        )
        await self.db.commit()
        return cursor.rowcount

    # ── Messages ────────────────────────────────────────────

    async def save_message(
        self,
        chat_id: int,
        message_id: int,
        sender_id: int,
        sender_name: str,
        text: str,
        topic: str | None = None,
        reply_to_message_id: int | None = None,
    ):
        await self.db.execute(
            """INSERT OR IGNORE INTO messages
               (chat_id, message_id, sender_id, sender_name, text, topic, reply_to_message_id, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (chat_id, message_id, sender_id, sender_name, text, topic, reply_to_message_id, _now()),
        )
        await self.db.commit()

    async def get_recent_messages(self, chat_id: int, limit: int = 10) -> list[dict]:
        async with self.db.execute(
            "SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?",
            (chat_id, limit),
        ) as cur:
            rows = [dict(r) for r in await cur.fetchall()]
            return list(reversed(rows))

    async def get_message(self, chat_id: int, message_id: int) -> dict | None:
        async with self.db.execute(
            "SELECT * FROM messages WHERE chat_id = ? AND message_id = ?",
            (chat_id, message_id),
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None

    async def get_messages_since(
        self, chat_id: int, since_minutes: int = 120
    ) -> list[dict]:
        async with self.db.execute(
            """SELECT * FROM messages
               WHERE chat_id = ? AND timestamp >= datetime('now', ?)
               ORDER BY timestamp ASC""",
            (chat_id, f"-{since_minutes} minutes"),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]

    async def get_message_count(self, chat_id: int | None = None) -> int:
        if chat_id is not None:
            async with self.db.execute(
                "SELECT COUNT(*) FROM messages WHERE chat_id = ?", (chat_id,)
            ) as cur:
                row = await cur.fetchone()
                return row[0] if row else 0
        async with self.db.execute("SELECT COUNT(*) FROM messages") as cur:
            row = await cur.fetchone()
            return row[0] if row else 0

    async def cleanup_old_messages(self, retention_hours: int = 48):
        cursor = await self.db.execute(
            "DELETE FROM messages WHERE timestamp < datetime('now', ?)",
            (f"-{retention_hours} hours",),
        )
        await self.db.commit()
        return cursor.rowcount

    async def mark_responded(self, chat_id: int, message_id: int):
        await self.db.execute(
            "UPDATE messages SET responded = TRUE WHERE chat_id = ? AND message_id = ?",
            (chat_id, message_id),
        )
        await self.db.commit()

    # ── Responses ───────────────────────────────────────────

    async def save_response(
        self,
        chat_id: int,
        in_reply_to: int | None,
        draft_text: str,
        response_type: str,
        confidence: float,
        reason: str,
        rag_results: str | None = None,
        db_data: str | None = None,
        model_name: str | None = None,
        prompt_hash: str | None = None,
        contains_link: bool = False,
        target_user_id: int | None = None,
        dm_text: str | None = None,
        audit_id: str | None = None,
    ) -> int:
        async with self.db.execute(
            """INSERT INTO responses
               (chat_id, in_reply_to, draft_text, response_type, confidence, reason,
                rag_results, db_data, model_name, prompt_hash,
                contains_link, target_user_id, dm_text, audit_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                chat_id, in_reply_to, draft_text, response_type, confidence, reason,
                rag_results, db_data, model_name, prompt_hash,
                contains_link, target_user_id, dm_text, audit_id, _now(),
            ),
        ) as cur:
            await self.db.commit()
            return cur.lastrowid

    async def get_response(self, response_id: int) -> dict | None:
        async with self.db.execute(
            "SELECT * FROM responses WHERE id = ?", (response_id,)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None

    async def get_pending_responses(self) -> list[dict]:
        async with self.db.execute(
            """SELECT * FROM responses
               WHERE status IN ('candidate', 'pending_approval', 'queued', 'sending')
               ORDER BY created_at ASC"""
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]

    async def get_responses_by_status(self, *statuses: str) -> list[dict]:
        if not statuses:
            return []
        placeholders = ", ".join("?" for _ in statuses)
        async with self.db.execute(
            f"""SELECT * FROM responses
                WHERE status IN ({placeholders})
                ORDER BY created_at ASC""",
            statuses,
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]

    async def update_response_status(self, response_id: int, status: str, **kwargs):
        sets = ["status = ?"]
        params: list = [status]
        for key, val in kwargs.items():
            sets.append(f"{key} = ?")
            params.append(val)
        params.append(response_id)
        await self.db.execute(
            f"UPDATE responses SET {', '.join(sets)} WHERE id = ?", params
        )
        await self.db.commit()

    async def count_responses_today(self, chat_id: int | None = None) -> int:
        if chat_id is not None:
            async with self.db.execute(
                """SELECT COUNT(*) FROM responses
                   WHERE status = 'sent' AND date(sent_at) = date('now')
                   AND chat_id = ?""",
                (chat_id,),
            ) as cur:
                return (await cur.fetchone())[0]
        async with self.db.execute(
            "SELECT COUNT(*) FROM responses WHERE status = 'sent' AND date(sent_at) = date('now')"
        ) as cur:
            return (await cur.fetchone())[0]

    # ── Contacts ────────────────────────────────────────────

    async def upsert_contact(
        self, user_id: int, username: str | None, display_name: str | None
    ):
        await self.db.execute(
            """INSERT INTO contacts (user_id, username, display_name, first_seen_at, last_seen_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                 username = COALESCE(excluded.username, contacts.username),
                 display_name = COALESCE(excluded.display_name, contacts.display_name),
                 last_seen_at = excluded.last_seen_at""",
            (user_id, username, display_name, _now(), _now()),
        )
        await self.db.commit()

    async def update_contact_activity(
        self,
        user_id: int,
        chat_id: int,
        has_topic: bool = False,
        topic_name: str | None = None,
    ):
        async with self.db.execute(
            "SELECT topics, groups_active_in, message_count, staking_message_count FROM contacts WHERE user_id = ?",
            (user_id,),
        ) as cur:
            row = await cur.fetchone()
            if not row:
                return

        topics: dict = json.loads(row[0] or "{}")
        groups: list = json.loads(row[1] or "[]")
        msg_count = row[2] + 1
        staking_count = row[3]

        if chat_id not in groups:
            groups.append(chat_id)

        if has_topic and topic_name:
            topics[topic_name] = topics.get(topic_name, 0) + 1
            if topic_name.lower() in ("staking", "validators", "delegation", "cosmos", "polkadot"):
                staking_count += 1

        await self.db.execute(
            """UPDATE contacts
               SET message_count = ?, staking_message_count = ?,
                   topics = ?, groups_active_in = ?,
                   groups_in_common = ?, last_seen_at = ?
               WHERE user_id = ?""",
            (msg_count, staking_count, json.dumps(topics), json.dumps(groups), len(groups), _now(), user_id),
        )
        await self.db.commit()

    async def get_contact(self, user_id: int) -> dict | None:
        async with self.db.execute(
            "SELECT * FROM contacts WHERE user_id = ?", (user_id,)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None

    async def get_top_contacts(self, limit: int = 50) -> list[dict]:
        async with self.db.execute(
            "SELECT * FROM contacts ORDER BY relevance_score DESC LIMIT ?", (limit,)
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]

    async def delete_contact(self, user_id: int):
        await self.db.execute("DELETE FROM contacts WHERE user_id = ?", (user_id,))
        await self.db.commit()

    async def update_relevance_scores(self):
        now = datetime.now(timezone.utc)
        now_str = _now()
        async with self.db.execute(
            "SELECT user_id, message_count, staking_message_count, groups_in_common, last_seen_at FROM contacts"
        ) as cur:
            rows = await cur.fetchall()

        for row in rows:
            user_id, msg_count, staking_count, groups_common, last_seen = row
            staking_ratio = staking_count / max(msg_count, 1)
            groups_factor = min(groups_common / 5.0, 1.0)
            days_since = 30.0
            if last_seen:
                try:
                    seen_dt = datetime.fromisoformat(last_seen).replace(tzinfo=timezone.utc)
                    days_since = (now - seen_dt).total_seconds() / 86400.0
                except (ValueError, TypeError):
                    pass
            recency_factor = max(0.0, 1.0 - days_since / 30.0)
            score = staking_ratio * 0.4 + groups_factor * 0.3 + recency_factor * 0.3
            await self.db.execute(
                "UPDATE contacts SET relevance_score = ?, relevance_updated_at = ? WHERE user_id = ?",
                (round(score, 4), now_str, user_id),
            )
        await self.db.commit()

    # ── Audit ───────────────────────────────────────────────

    _AUDIT_UPDATABLE = {
        "status", "original_text", "topic", "rag_query", "rag_results",
        "claude_prompt", "claude_raw", "claude_parsed", "claude_duration_ms",
        "approval_decision", "approval_edit", "final_text", "final_dm_text",
        "sent_at", "error",
    }

    _TOOL_OUTPUT_MAX_BYTES = 10 * 1024

    async def init_audit_log(
        self,
        audit_id: str,
        chat_id: int,
        message_id: int | None = None,
        sender_id: int | None = None,
        original_text: str | None = None,
        topic: str | None = None,
        status: str = "generating",
    ):
        await self.db.execute(
            """INSERT INTO audit_log
                 (id, created_at, chat_id, message_id, sender_id, status, original_text, topic)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO NOTHING""",
            (audit_id, _now(), chat_id, message_id, sender_id, status, original_text, topic),
        )
        await self.db.commit()

    async def update_audit_log(self, audit_id: str, **fields):
        sets = []
        vals: list = []
        for key, val in fields.items():
            if key in self._AUDIT_UPDATABLE:
                sets.append(f"{key} = ?")
                vals.append(val)
        if not sets:
            return
        vals.append(audit_id)
        await self.db.execute(
            f"UPDATE audit_log SET {', '.join(sets)} WHERE id = ?",
            vals,
        )
        await self.db.commit()

    async def save_tool_call(
        self,
        audit_id: str,
        phase: str,
        sequence: int,
        tool_name: str,
        tool_input: str | None = None,
        tool_output: str | None = None,
        latency_ms: int | None = None,
    ):
        truncated = 0
        capped_input = tool_input
        capped_output = tool_output
        if capped_input is not None and len(capped_input.encode("utf-8")) > self._TOOL_OUTPUT_MAX_BYTES:
            capped_input = capped_input.encode("utf-8")[: self._TOOL_OUTPUT_MAX_BYTES].decode("utf-8", "ignore")
            truncated = 1
        if capped_output is not None and len(capped_output.encode("utf-8")) > self._TOOL_OUTPUT_MAX_BYTES:
            capped_output = capped_output.encode("utf-8")[: self._TOOL_OUTPUT_MAX_BYTES].decode("utf-8", "ignore")
            truncated = 1
        await self.db.execute(
            """INSERT INTO tool_calls
                 (audit_id, phase, sequence, tool_name, tool_input, tool_output,
                  output_truncated, latency_ms, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                audit_id, phase, sequence, tool_name,
                capped_input, capped_output, truncated, latency_ms, _now(),
            ),
        )
        await self.db.commit()

    async def redact_old_audit_logs(self, days: int = 90):
        await self.db.execute(
            """UPDATE audit_log SET
                 original_text = NULL, claude_prompt = NULL,
                 claude_raw = NULL, claude_parsed = NULL,
                 rag_results = NULL
               WHERE datetime(created_at) < datetime('now', ?)""",
            (f"-{days} days",),
        )
        await self.db.execute(
            """UPDATE tool_calls SET tool_input = NULL, tool_output = NULL
               WHERE audit_id IN (
                 SELECT id FROM audit_log
                 WHERE datetime(created_at) < datetime('now', ?)
               )""",
            (f"-{days} days",),
        )
        await self.db.commit()

    async def redact_audit_logs_for_sender(self, sender_id: int):
        await self.db.execute(
            """UPDATE audit_log SET
                 original_text = NULL,
                 claude_prompt = NULL,
                 claude_raw = NULL,
                 claude_parsed = NULL,
                 rag_results = NULL
               WHERE sender_id = ?""",
            (sender_id,),
        )
        await self.db.execute(
            """UPDATE tool_calls SET tool_input = NULL, tool_output = NULL
               WHERE audit_id IN (
                 SELECT id FROM audit_log WHERE sender_id = ?
               )""",
            (sender_id,),
        )
        await self.db.commit()

    # ── LLM Filter Log ─────────────────────────────────────

    async def save_filter_log(
        self,
        source: str,
        chat_id: int,
        message_id: int | None,
        sender_id: int | None,
        sender_name: str | None,
        decision: str,
        reason: str,
        latency_ms: int,
        attempts: int,
    ):
        await self.db.execute(
            """INSERT INTO llm_filter_log
               (source, chat_id, message_id, sender_id, sender_name,
                decision, reason, latency_ms, attempts)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                source,
                chat_id,
                message_id,
                sender_id,
                sender_name,
                decision,
                reason,
                latency_ms,
                attempts,
            ),
        )
        await self.db.commit()

    async def get_filter_log(self, chat_id: int, message_id: int | None) -> dict | None:
        if message_id is None:
            async with self.db.execute(
                """SELECT * FROM llm_filter_log
                   WHERE chat_id = ? AND message_id IS NULL
                   ORDER BY created_at DESC, id DESC LIMIT 1""",
                (chat_id,),
            ) as cur:
                row = await cur.fetchone()
                return dict(row) if row else None

        async with self.db.execute(
            """SELECT * FROM llm_filter_log
               WHERE chat_id = ? AND message_id = ?
               ORDER BY created_at DESC, id DESC LIMIT 1""",
            (chat_id, message_id),
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None

    async def redact_filter_logs_for_sender(self, sender_id: int) -> int:
        cursor = await self.db.execute(
            "UPDATE llm_filter_log SET sender_name = NULL WHERE sender_id = ?",
            (sender_id,),
        )
        await self.db.commit()
        return cursor.rowcount

    async def cleanup_old_filter_logs(self, days: int) -> int:
        cursor = await self.db.execute(
            "DELETE FROM llm_filter_log WHERE created_at < datetime('now', ?)",
            (f"-{days} days",),
        )
        await self.db.commit()
        return cursor.rowcount

    # ── Digest ──────────────────────────────────────────────

    async def get_topic_digest(self, days: int = 7) -> dict:
        """Aggregate topic stats for the last N days."""
        # Top topics by message count
        async with self.db.execute(
            """SELECT topic, COUNT(*) as cnt FROM messages
               WHERE topic IS NOT NULL AND timestamp >= datetime('now', ?)
               GROUP BY topic ORDER BY cnt DESC LIMIT 15""",
            (f"-{days} days",),
        ) as cur:
            top_topics = [(row[0], row[1]) for row in await cur.fetchall()]

        # Most active groups
        async with self.db.execute(
            """SELECT g.name, COUNT(*) as cnt FROM messages m
               JOIN groups g ON g.chat_id = m.chat_id
               WHERE m.timestamp >= datetime('now', ?)
               GROUP BY m.chat_id ORDER BY cnt DESC LIMIT 10""",
            (f"-{days} days",),
        ) as cur:
            active_groups = [(row[0] or "?", row[1]) for row in await cur.fetchall()]

        # Skipped responses (Claude returned skip or low confidence)
        async with self.db.execute(
            """SELECT COUNT(*) FROM responses
               WHERE created_at >= datetime('now', ?) AND status = 'rejected'""",
            (f"-{days} days",),
        ) as cur:
            rejected = (await cur.fetchone())[0]

        async with self.db.execute(
            """SELECT COUNT(*) FROM responses
               WHERE created_at >= datetime('now', ?) AND status = 'sent'""",
            (f"-{days} days",),
        ) as cur:
            sent = (await cur.fetchone())[0]

        return {
            "top_topics": top_topics,
            "active_groups": active_groups,
            "sent": sent,
            "rejected": rejected,
            "days": days,
        }

    # ── Stats ───────────────────────────────────────────────

    async def stats(self) -> dict:
        msg_count = await self.get_message_count()
        sent_today = await self.count_responses_today()

        async with self.db.execute("SELECT COUNT(*) FROM contacts") as cur:
            contact_count = (await cur.fetchone())[0]
        async with self.db.execute("SELECT COUNT(*) FROM responses") as cur:
            response_count = (await cur.fetchone())[0]
        async with self.db.execute(
            "SELECT COUNT(*) FROM responses WHERE status = 'pending_approval'"
        ) as cur:
            pending_count = (await cur.fetchone())[0]
        async with self.db.execute(
            "SELECT status, COUNT(*) FROM groups GROUP BY status"
        ) as cur:
            groups_by_status = {row[0]: row[1] for row in await cur.fetchall()}

        return {
            "groups": sum(groups_by_status.values()),
            "groups_by_status": groups_by_status,
            "messages": msg_count,
            "contacts": contact_count,
            "responses_total": response_count,
            "responses_pending": pending_count,
            "responses_sent_today": sent_today,
        }
