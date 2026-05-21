import { ingestResendWebhookEvent } from "@bizdev/db";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

type JsonRecord = Record<string, unknown>;
type ResendWebhookChannel = "delivery" | "inbound";

const webhookSecretEnvByChannel: Record<ResendWebhookChannel, string> = {
  delivery: "RESEND_WEBHOOK_SECRET_DELIVERY",
  inbound: "RESEND_WEBHOOK_SECRET_INBOUND"
};

export async function handleResendWebhook(request: Request, channel: ResendWebhookChannel) {
  const rawBody = await request.text();
  const signatureResult = verifyResendWebhookSignature(rawBody, request.headers, channel);
  if (!signatureResult.ok) {
    return NextResponse.json({ error: signatureResult.error }, { status: signatureResult.status });
  }
  const parsedBody = parseJsonBody(rawBody);
  if (!parsedBody.ok) {
    return NextResponse.json({ error: parsedBody.error }, { status: 400 });
  }

  const eventType = readString(parsedBody.value, ["type"])
    ?? readString(parsedBody.value, ["event"])
    ?? readString(parsedBody.value, ["event_type"]);

  if (!eventType) {
    return NextResponse.json({ error: "Missing Resend event type" }, { status: 400 });
  }
  if (!isEventTypeAllowedForChannel(channel, eventType)) {
    return NextResponse.json(
      { error: `Resend event type ${eventType} is not allowed on ${channel} webhook` },
      { status: 400 }
    );
  }

  const providerEventId = readString(parsedBody.value, ["id"])
    ?? readString(parsedBody.value, ["event_id"])
    ?? readString(parsedBody.value, ["eventId"]);
  const providerMessageId = extractProviderMessageId(parsedBody.value);
  const providerEventTimestamp = extractProviderEventTimestamp(parsedBody.value);
  const recipientEmail = extractRecipientEmail(parsedBody.value);
  const suppressionReason = classifySuppressionReason(eventType);

  const result = await ingestResendWebhookEvent({
    svixId: signatureResult.svixId,
    eventType,
    dedupeKey: buildDedupeKey({
      eventType,
      body: parsedBody.value,
      ...(providerEventId ? { providerEventId } : {}),
      ...(providerMessageId ? { providerMessageId } : {}),
      ...(providerEventTimestamp ? { providerEventTimestamp } : {})
    }),
    rawHeadersJson: headersToJson(request.headers),
    rawBodyJson: parsedBody.value,
    ...(providerEventId ? { providerEventId } : {}),
    ...(recipientEmail ? { recipientEmail } : {}),
    ...(suppressionReason ? { suppressionReason } : {})
  });

  if (result.deduplicated && !result.webhookEventId) {
    return NextResponse.json({ deduplicated: true });
  }

  return NextResponse.json({
    received: true,
    provider: "resend",
    eventType,
    recipientEmail: recipientEmail ?? null,
    suppressionReason: suppressionReason ?? null,
    ...result
  });
}

function parseJsonBody(rawBody: string): { ok: true; value: JsonRecord } | { ok: false; error: string } {
  if (!rawBody.trim()) {
    return { ok: false, error: "Empty webhook body" };
  }

  try {
    const value = JSON.parse(rawBody) as unknown;
    if (!isRecord(value)) {
      return { ok: false, error: "Webhook body must be a JSON object" };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, error: "Invalid JSON webhook body" };
  }
}

function buildDedupeKey(input: {
  providerEventId?: string;
  providerMessageId?: string;
  providerEventTimestamp?: string;
  eventType: string;
  body: JsonRecord;
}): string {
  if (input.providerEventId) {
    return `resend:event:${input.providerEventId}`;
  }

  if (input.providerMessageId && input.providerEventTimestamp) {
    return `resend:message-event:${input.providerMessageId}:${input.eventType}:${input.providerEventTimestamp}`;
  }

  return `resend:body:${createHash("sha256").update(stableStringify(input.body)).digest("hex")}`;
}

function verifyResendWebhookSignature(
  rawBody: string,
  headers: Headers,
  channel: ResendWebhookChannel
): { ok: true; svixId: string } | { ok: false; error: string; status: number } {
  const webhookSecretEnv = webhookSecretEnvByChannel[channel];
  const webhookSecret = process.env[webhookSecretEnv];
  if (!webhookSecret) {
    return { ok: false, error: `${webhookSecretEnv} is required`, status: 503 };
  }

  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return { ok: false, error: "Missing Resend signature headers", status: 401 };
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > 300) {
    return { ok: false, error: "Invalid Resend signature timestamp", status: 401 };
  }

  const secret = decodeSvixSecret(webhookSecret);
  const signedPayload = `${id}.${timestamp}.${rawBody}`;
  const expectedSignature = createHmac("sha256", secret).update(signedPayload).digest();
  const providedSignatures = signature
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1,"))
    .map((part) => Buffer.from(part.slice(3), "base64"));

  for (const providedSignature of providedSignatures) {
    if (
      providedSignature.length === expectedSignature.length
      && timingSafeEqual(providedSignature, expectedSignature)
    ) {
      return { ok: true, svixId: id };
    }
  }

  return { ok: false, error: "Invalid Resend signature", status: 401 };
}

function decodeSvixSecret(secret: string): Buffer {
  const base64Secret = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(base64Secret, "base64");
}

function classifySuppressionReason(eventType: string): string | undefined {
  const normalized = eventType.toLowerCase();
  if (normalized === "complaint" || normalized.endsWith(".complaint") || normalized.endsWith(".complained")) {
    return "complaint";
  }
  if (normalized.endsWith(".bounced") || normalized.endsWith(".hard_bounced") || normalized.endsWith(".hard-bounced")) {
    return "hard_bounce";
  }
  if (normalized === "unsubscribe" || normalized.endsWith(".unsubscribe") || normalized.endsWith(".unsubscribed")) {
    return "unsubscribe";
  }
  return undefined;
}

function isEventTypeAllowedForChannel(channel: ResendWebhookChannel, eventType: string): boolean {
  const normalized = eventType.toLowerCase();
  const isInbound = normalized === "email.received";
  return channel === "inbound" ? isInbound : !isInbound;
}

function extractRecipientEmail(body: JsonRecord): string | undefined {
  const data = readRecord(body, ["data"]);
  const candidates = [
    readUnknown(data, ["to"]),
    readUnknown(data, ["recipient"]),
    readUnknown(data, ["recipient_email"]),
    readUnknown(data, ["to_email"]),
    readUnknown(data, ["email"]),
    readUnknown(body, ["recipientEmail"]),
    readUnknown(body, ["recipient_email"]),
    readUnknown(body, ["email"])
  ];

  for (const candidate of candidates) {
    const email = normalizeEmail(candidate);
    if (email) {
      return email;
    }
  }

  return undefined;
}

function extractProviderMessageId(body: JsonRecord): string | undefined {
  const data = readRecord(body, ["data"]);
  return readString(data, ["email_id"])
    ?? readString(data, ["message_id"])
    ?? readString(data, ["id"])
    ?? readString(body, ["email_id"])
    ?? readString(body, ["message_id"]);
}

function extractProviderEventTimestamp(body: JsonRecord): string | undefined {
  const data = readRecord(body, ["data"]);
  return readString(body, ["created_at"])
    ?? readString(body, ["timestamp"])
    ?? readString(data, ["created_at"])
    ?? readString(data, ["timestamp"]);
}

function normalizeEmail(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const email = normalizeEmail(item);
      if (email) {
        return email;
      }
    }
    return undefined;
  }

  if (isRecord(value)) {
    return normalizeEmail(value.email ?? value.address);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase();
}

function headersToJson(headers: Headers): JsonRecord {
  const result: JsonRecord = {};
  for (const [key, value] of headers.entries()) {
    result[key] = shouldRedactHeader(key) ? "[redacted]" : value;
  }
  return result;
}

function shouldRedactHeader(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "authorization"
    || normalized === "cookie"
    || normalized === "set-cookie"
    || normalized.startsWith("svix-");
}

function readString(record: JsonRecord, path: string[]): string | undefined {
  const value = readUnknown(record, path);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readRecord(record: JsonRecord, path: string[]): JsonRecord {
  const value = readUnknown(record, path);
  return isRecord(value) ? value : {};
}

function readUnknown(record: JsonRecord, path: string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
