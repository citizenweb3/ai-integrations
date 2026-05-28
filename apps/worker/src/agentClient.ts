import type { AgentStageDispatcher } from "@bizdev/db";

// Optional Bearer auth protects /runs when the agent is reachable beyond the
// local Docker bridge. Local dev stays unauthenticated when AGENT_RUN_SECRET is unset.
export function createHttpAgentDispatcher(options: {
  baseUrl: string;
  bearerToken?: string | null;
  // T-026X: overall hard timeout on a single agent run. If the agent stops
  // streaming (network drop / agent restart mid-run / Vertex AI stall) the
  // worker would otherwise hang indefinitely in the `await reader.read()`
  // loop — the lease-recovery cron flips the job back to `queued` but the
  // worker process stays stuck on the dead stream. With this timeout the
  // dispatcher throws, the handler routes it through the normal run_failed
  // path, and the job re-leases cleanly on the next worker tick.
  //
  // Default: 300s (5 min). Configurable via AGENT_REQUEST_TIMEOUT_SECONDS env.
  timeoutMs?: number;
}): AgentStageDispatcher {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const bearerToken = options.bearerToken?.trim();
  const timeoutMs = options.timeoutMs ?? readTimeoutFromEnv();

  return async function* dispatch(request) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}/runs/${encodeURIComponent(request.stage)}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: request.prompt, user_id: request.userId ?? null }),
        signal: controller.signal
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
    } catch (err) {
      // Translate aborts into a clearer message; everything else falls through
      // unchanged so callers see the original failure (network, parse, etc).
      const isAbort =
        (err instanceof Error && err.name === "AbortError") ||
        (typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError");
      if (isAbort) {
        throw new Error(
          `Agent request timed out after ${timeoutMs}ms (set AGENT_REQUEST_TIMEOUT_SECONDS to override)`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}

function readTimeoutFromEnv(): number {
  const raw = process.env.AGENT_REQUEST_TIMEOUT_SECONDS;
  if (!raw) return 300_000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 300_000;
  return parsed * 1000;
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
