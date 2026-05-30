import { NextResponse } from "next/server";

// Thin proxy to the agent service's POST /assist/scope. Each request carries
// the full chat history (client-side state — there is no session table). The
// agent replies with a single AssistTurn JSON; this route just forwards.
//
// Auth: reuses AGENT_RUN_SECRET so the same Bearer the worker uses for
// /runs/{stage} is accepted by /assist/scope. Local dev stays unauthenticated
// when the secret is unset, matching the worker's contract.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface AssistRequestBody {
  messages: ChatMessage[];
}

const MAX_MESSAGES = 40;
const ALLOWED_ROLES: ReadonlySet<ChatRole> = new Set(["user", "assistant"]);

export async function POST(request: Request): Promise<Response> {
  const baseUrl = process.env.AGENT_BASE_URL?.trim();
  if (!baseUrl) {
    return NextResponse.json(
      { error: "AGENT_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }

  const validation = validateAssistRequest(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  const bearerToken = process.env.AGENT_RUN_SECRET?.trim();
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }

  const target = `${baseUrl.replace(/\/+$/, "")}/assist/scope`;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify(validation.value),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "agent service unreachable", detail: message.slice(0, 500) },
      { status: 503 },
    );
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: `agent returned ${upstream.status}`,
        detail: text.slice(0, 500),
      },
      { status: 502 },
    );
  }

  // Re-parse so a malformed 200 surfaces as 502 with a precise message
  // instead of an opaque client-side JSON.parse failure.
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return NextResponse.json(
      {
        error: "agent returned malformed JSON",
        detail: text.slice(0, 500),
      },
      { status: 502 },
    );
  }

  return NextResponse.json(payload);
}

function validateAssistRequest(
  body: unknown,
): { ok: true; value: AssistRequestBody } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "body must be an object" };
  }
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) {
    return { ok: false, error: "messages must be an array" };
  }
  if (messages.length === 0) {
    return { ok: false, error: "messages must not be empty" };
  }
  if (messages.length > MAX_MESSAGES) {
    return { ok: false, error: `messages must not exceed ${MAX_MESSAGES} entries` };
  }
  const normalized: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const raw = messages[i];
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: `messages[${i}] must be an object` };
    }
    const role = (raw as { role?: unknown }).role;
    const content = (raw as { content?: unknown }).content;
    if (typeof role !== "string" || !ALLOWED_ROLES.has(role as ChatRole)) {
      return { ok: false, error: `messages[${i}].role must be "user" or "assistant"` };
    }
    if (typeof content !== "string" || content.length === 0) {
      return { ok: false, error: `messages[${i}].content must be a non-empty string` };
    }
    normalized.push({ role: role as ChatRole, content });
  }
  const last = normalized[normalized.length - 1];
  if (!last || last.role !== "user") {
    return { ok: false, error: "conversation must end with a user message" };
  }
  return { ok: true, value: { messages: normalized } };
}
