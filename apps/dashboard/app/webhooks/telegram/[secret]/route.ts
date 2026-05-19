import {
  appendEvent,
  parseTelegramOperatorAllowlist,
  processTelegramInboundUpdate,
  type TelegramInboundUpdate
} from "@bizdev/db";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

type JsonRecord = Record<string, unknown>;

export const dynamic = "force-dynamic";

// Parse the operator allowlist once at module load. The map is read-only at
// runtime; restart is required to pick up changes. An empty / missing env
// disables state-change commands but leaves /help and /queue working.
const operatorAllowlist = parseTelegramOperatorAllowlist(process.env.TELEGRAM_OPERATOR_MAP);

// `/approve` resolves the draft body + recipient at command time but the
// `From:` address has no per-draft source — fall back to the dashboard-wide
// default. `TELEGRAM_DEFAULT_FROM_EMAIL` lets the operator pin a specific
// sender for Telegram-initiated sends; if unset we reuse `RESEND_FROM_EMAIL`
// (the worker uses the same env for outbound dispatch). When both are unset
// the `/approve` branch fails with a structured error rather than silently
// inventing a sender.
const defaultFromEmail = process.env.TELEGRAM_DEFAULT_FROM_EMAIL ?? process.env.RESEND_FROM_EMAIL ?? null;

export async function POST(
  request: Request,
  context: { params: Promise<{ secret: string }> }
): Promise<NextResponse> {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "TELEGRAM_WEBHOOK_SECRET not configured" },
      { status: 503 }
    );
  }

  const params = await context.params;
  const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
  const candidate = headerSecret ?? params.secret;
  if (!candidate || !secretsEqual(candidate, expectedSecret)) {
    return NextResponse.json({ error: "invalid telegram secret" }, { status: 401 });
  }

  const rawBody = await request.text();
  const parsed = parseJsonBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const update = extractUpdate(parsed.value);
  if (!update) {
    // Unparseable updates are ack'd with 200 so Telegram doesn't retry, but
    // we don't audit yet — we have nothing trustworthy to log. The event log
    // would only confuse future debugging.
    return NextResponse.json({ received: true, ignored: "no_update_id" });
  }

  const correlationId = randomUUID();
  try {
    const result = await processTelegramInboundUpdate({ update, correlationId, operatorAllowlist, defaultFromEmail });
    return NextResponse.json({ received: true, result });
  } catch (error) {
    // Always return 200 to Telegram. A 5xx response would trigger Telegram's
    // retry policy (the same update_id redelivered every few seconds for the
    // retry window) — under transient downstream failure this floods the
    // queue and amplifies any underlying issue. The failure is recorded out
    // of band so ops can triage from the audit trail. Idempotency on the
    // dedup index protects against the eventually-successful retry.
    const message = error instanceof Error ? error.message : String(error);
    try {
      await appendEvent({
        eventType: "telegram_inbound_processing_failed",
        correlationId,
        payloadJson: { updateId: update.updateId, error: message }
      });
    } catch {
      // Audit append best-effort — if the DB itself is unhealthy we still
      // want to ack Telegram so deliveries don't pile up.
    }
    return NextResponse.json({ received: true, error: message });
  }
}

function secretsEqual(a: string, b: string): boolean {
  // `timingSafeEqual` requires equal-length buffers; an early length-based
  // return would leak the secret length via response timing. Pad both inputs
  // to a common length so the comparison takes constant time regardless of
  // the candidate's length, then verify lengths match after.
  const max = Math.max(a.length, b.length, 1);
  const aBuf = Buffer.alloc(max);
  const bBuf = Buffer.alloc(max);
  Buffer.from(a).copy(aBuf);
  Buffer.from(b).copy(bBuf);
  const equal = timingSafeEqual(aBuf, bBuf);
  return equal && a.length === b.length;
}

function parseJsonBody(rawBody: string): { ok: true; value: JsonRecord } | { ok: false; error: string } {
  if (!rawBody.trim()) return { ok: false, error: "Empty webhook body" };
  try {
    const value = JSON.parse(rawBody) as unknown;
    if (!isRecord(value)) return { ok: false, error: "Body must be a JSON object" };
    return { ok: true, value };
  } catch {
    return { ok: false, error: "Invalid JSON webhook body" };
  }
}

function extractUpdate(body: JsonRecord): TelegramInboundUpdate | null {
  const updateId = readNumber(body, "update_id");
  if (updateId === null) return null;

  const messageRaw = body["message"] ?? body["edited_message"] ?? body["channel_post"];
  if (!isRecord(messageRaw)) {
    return { updateId };
  }

  const text = readString(messageRaw, "text");
  const chatRaw = messageRaw["chat"];
  const fromRaw = messageRaw["from"];
  const chatId = isRecord(chatRaw) ? readNumber(chatRaw, "id") : null;
  const fromId = isRecord(fromRaw) ? readNumber(fromRaw, "id") : null;
  const fromUsername = isRecord(fromRaw) ? readString(fromRaw, "username") : null;

  const chat: { id: number } | undefined = chatId !== null ? { id: chatId } : undefined;
  const from = fromId !== null || fromUsername !== null
    ? {
        ...(fromId !== null ? { id: fromId } : {}),
        ...(fromUsername !== null ? { username: fromUsername } : {})
      }
    : undefined;

  return {
    updateId,
    message: {
      ...(text ? { text } : {}),
      ...(chat ? { chat } : {}),
      ...(from ? { from } : {})
    }
  };
}

function readNumber(record: JsonRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
