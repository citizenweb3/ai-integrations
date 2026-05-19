import type { AgentStageDispatcher } from "@bizdev/db";

// TODO(post-MVP): add a shared secret / mTLS between worker and agent service
// when the compose network model expands beyond a local Docker bridge.
export function createHttpAgentDispatcher(options: { baseUrl: string }): AgentStageDispatcher {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  return async function* dispatch(request) {
    const response = await fetch(`${baseUrl}/runs/${encodeURIComponent(request.stage)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
