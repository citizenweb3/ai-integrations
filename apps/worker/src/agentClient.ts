import type { AgentStageDispatcher } from "@bizdev/db";

// Optional Bearer auth protects /runs when the agent is reachable beyond the
// local Docker bridge. Local dev stays unauthenticated when AGENT_RUN_SECRET is unset.
export function createHttpAgentDispatcher(options: {
  baseUrl: string;
  bearerToken?: string | null;
}): AgentStageDispatcher {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const bearerToken = options.bearerToken?.trim();

  return async function* dispatch(request) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;

    const response = await fetch(`${baseUrl}/runs/${encodeURIComponent(request.stage)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: request.prompt, user_id: request.userId ?? null })
    });

    if (!response.ok || !response.body) {
      throw new Error(`Agent ingress returned ${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newlineIdx = buffer.indexOf("\n");
      while (newlineIdx >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        newlineIdx = buffer.indexOf("\n");
        if (!line) continue;
        yield parseStreamLine(line);
      }
    }

    const tail = buffer.trim();
    if (tail) {
      yield parseStreamLine(tail);
    }
  };
}

function parseStreamLine(line: string): { eventType: string; payloadJson: Record<string, unknown> } {
  let parsed: { event_type?: unknown; payload?: unknown };
  try {
    parsed = JSON.parse(line) as typeof parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const preview = line.length > 120 ? `${line.slice(0, 120)}…` : line;
    throw new Error(`Agent NDJSON parse error (${message}) at line: ${JSON.stringify(preview)}`);
  }

  const eventType = typeof parsed.event_type === "string" ? parsed.event_type : null;
  if (!eventType) {
    throw new Error(`Agent NDJSON line missing event_type: ${JSON.stringify(line)}`);
  }
  const payload = parsed.payload && typeof parsed.payload === "object"
    ? parsed.payload as Record<string, unknown>
    : {};
  return { eventType, payloadJson: payload };
}
