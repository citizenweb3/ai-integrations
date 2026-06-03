import { NextResponse } from "next/server";

// T-026BO: thin proxy to the agent's POST /assist/study-site. The chat sends a
// URL the operator agreed to study; the agent reads it (grounded) and returns
// plain-text facts which the chat then replays into /assist/scope as
// siteStudyResult. Same Bearer contract as the scope proxy.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const baseUrl = process.env.AGENT_BASE_URL?.trim();
  if (!baseUrl) {
    return NextResponse.json({ error: "AGENT_BASE_URL is not configured" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }

  const url = (body as { url?: unknown }).url;
  if (typeof url !== "string" || !(url.startsWith("http://") || url.startsWith("https://"))) {
    return NextResponse.json(
      { error: "url must be a string starting with http:// or https://" },
      { status: 400 },
    );
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  const bearerToken = process.env.AGENT_RUN_SECRET?.trim();
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }

  const target = `${baseUrl.replace(/\/+$/, "")}/assist/study-site`;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: url.slice(0, 2000) }),
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
      { error: `agent returned ${upstream.status}`, detail: text.slice(0, 500) },
      { status: 502 },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: "agent returned malformed JSON", detail: text.slice(0, 500) },
      { status: 502 },
    );
  }

  return NextResponse.json(payload);
}
