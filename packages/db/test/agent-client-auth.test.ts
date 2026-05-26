import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { after, test } from "node:test";
import { createHttpAgentDispatcher } from "../../../apps/worker/src/agentClient";
import { closeDb } from "../src";

after(async () => {
  await closeDb();
});

test("agent HTTP dispatcher sends bearer auth when configured", async () => {
  let observedAuthorization: string | undefined;
  const baseUrl = await withAgentStub((request, response) => {
    observedAuthorization = request.headers.authorization;
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    response.end([
      JSON.stringify({ event_type: "final_response", payload: { text: "ok" } }),
      JSON.stringify({ event_type: "run_succeeded", payload: { final_text: "ok" } })
    ].join("\n"));
  });

  const dispatcher = createHttpAgentDispatcher({
    baseUrl,
    bearerToken: "agent-secret"
  });
  const events = [];
  for await (const event of dispatcher({ stage: "research_quality_gate", prompt: "test" })) {
    events.push(event);
  }

  assert.equal(observedAuthorization, "Bearer agent-secret");
  assert.deepEqual(events.map((event) => event.eventType), ["final_response", "run_succeeded"]);
});

test("agent HTTP dispatcher omits bearer auth when unset", async () => {
  let observedAuthorization: string | undefined;
  const baseUrl = await withAgentStub((request, response) => {
    observedAuthorization = request.headers.authorization;
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    response.end(`${JSON.stringify({ event_type: "run_succeeded", payload: {} })}\n`);
  });

  const dispatcher = createHttpAgentDispatcher({ baseUrl });
  for await (const _event of dispatcher({ stage: "research_quality_gate", prompt: "test" })) {
    // drain stream
  }

  assert.equal(observedAuthorization, undefined);
});

async function withAgentStub(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  test.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${address.port}`;
}
