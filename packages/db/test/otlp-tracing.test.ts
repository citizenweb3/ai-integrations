import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  closeDb,
  commands,
  configureOtlpExporterForTest,
  eventLog,
  flushOtlpExporterForTest,
  getDb,
  getTraceBaggage,
  isOtlpExporterEnabled,
  resumeAllSendsCommand,
  traceOperation
} from "../src";
import { POST as commandsPost } from "../../../apps/dashboard/app/api/commands/route";

after(async () => {
  await closeDb();
});

test("OTLP tracing is silent when endpoint is unset", async (t) => {
  const previousEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  t.after(() => restoreEndpoint(previousEndpoint));

  let exports = 0;
  const restoreExporter = configureOtlpExporterForTest(async () => {
    exports += 1;
  });
  t.after(restoreExporter);

  assert.equal(isOtlpExporterEnabled(), false);
  await traceOperation({
    serviceName: "test",
    name: "test.noop",
    correlationId: "corr-unset"
  }, async () => {
    assert.deepEqual(getTraceBaggage(), { correlationId: "corr-unset" });
  });

  assert.equal(exports, 0);
});

test("OTLP tracing exports spans and propagates correlationId as baggage", async (t) => {
  const previousEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector:4318";
  t.after(() => restoreEndpoint(previousEndpoint));

  const exported: Array<{ endpoint: string; payload: Record<string, unknown> }> = [];
  const restoreExporter = configureOtlpExporterForTest(async (endpoint, payload) => {
    exported.push({ endpoint, payload });
  });
  t.after(restoreExporter);

  assert.equal(isOtlpExporterEnabled(), true);
  await traceOperation({
    serviceName: "test",
    name: "test.outer",
    kind: "server",
    correlationId: "corr-t025",
    attributes: { route: "/api/test" }
  }, async () => {
    assert.deepEqual(getTraceBaggage(), { correlationId: "corr-t025" });
    await traceOperation({
      serviceName: "test",
      name: "test.inner",
      kind: "internal",
      attributes: { stage: "inner" }
    }, async () => {
      assert.deepEqual(getTraceBaggage(), { correlationId: "corr-t025" });
    });
  });

  await flushOtlpExporterForTest();
  assert.equal(exported.length, 2);
  assert.equal(exported[0]?.endpoint, "http://otel-collector:4318/v1/traces");
  const spans = exported.map((entry) => readOnlySpan(entry.payload));
  const inner = spans.find((span) => span.name === "test.inner");
  const outer = spans.find((span) => span.name === "test.outer");
  assert.ok(inner);
  assert.ok(outer);
  assert.equal(inner.traceId, outer.traceId);
  assert.equal(inner.parentSpanId, outer.spanId);
  assert.equal(readStringAttribute(inner, "trace.baggage"), "correlationId=corr-t025");
  assert.equal(readStringAttribute(outer, "trace.baggage"), "correlationId=corr-t025");
  assert.equal(readStringAttribute(outer, "correlationId"), "corr-t025");
});

test("OTLP tracing does not block command execution when exporter hangs", async (t) => {
  const previousEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const previousTimeout = process.env.OTEL_EXPORTER_OTLP_TIMEOUT_MS;
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector:4318";
  process.env.OTEL_EXPORTER_OTLP_TIMEOUT_MS = "5";
  t.after(() => restoreEndpoint(previousEndpoint));
  t.after(() => restoreOptionalEnv("OTEL_EXPORTER_OTLP_TIMEOUT_MS", previousTimeout));

  const restoreExporter = configureOtlpExporterForTest(async () => {
    await new Promise<void>(() => {
      // Simulates a collector/exporter that never responds.
    });
  });
  t.after(restoreExporter);

  const startedAt = Date.now();
  await traceOperation({
    serviceName: "test",
    name: "test.hanging_exporter",
    correlationId: "corr-hanging"
  }, async () => "ok");

  assert.ok(Date.now() - startedAt < 50);
  await flushOtlpExporterForTest();
});

test("dashboard command trace exports the command correlationId", async (t) => {
  const previousEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector:4318";
  t.after(() => restoreEndpoint(previousEndpoint));

  const exported: Array<{ endpoint: string; payload: Record<string, unknown> }> = [];
  const restoreExporter = configureOtlpExporterForTest(async (endpoint, payload) => {
    exported.push({ endpoint, payload });
  });
  t.after(restoreExporter);

  const db = getDb();
  const suffix = randomUUID();
  const pauseIdempotencyKey = `pause_all_sends:t025-trace:${suffix}`;
  const resumeIdempotencyKey = `resume_all_sends:t025-trace:${suffix}`;
  t.after(async () => {
    await resumeAllSendsCommand({
      payload: {
        idempotencyKey: resumeIdempotencyKey
      }
    });
    const commandRows = await db
      .select({ id: commands.id })
      .from(commands)
      .where(inArray(commands.idempotencyKey, [
        pauseIdempotencyKey,
        resumeIdempotencyKey
      ]));
    const commandIds = commandRows.map((row) => row.id);
    if (commandIds.length > 0) {
      await db.delete(eventLog).where(inArray(eventLog.commandId, commandIds));
      await db.delete(commands).where(inArray(commands.id, commandIds));
    }
  });

  const response = await commandsPost(new Request("http://localhost/api/commands", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "req-t025-trace"
    },
    body: JSON.stringify({
      commandType: "pause_all_sends",
      payload: {
        reason: `T-025 trace ${suffix}`,
        idempotencyKey: pauseIdempotencyKey
      }
    })
  }));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { commandId: string };
  const [command] = await db
    .select({ correlationId: commands.correlationId })
    .from(commands)
    .where(eq(commands.id, body.commandId))
    .limit(1);
  assert.ok(command);

  await flushOtlpExporterForTest();
  const spans = exported.map((entry) => readOnlySpan(entry.payload));
  const commandSpan = spans.find((span) => span.name === "dashboard.commandExecution");
  assert.ok(commandSpan);
  assert.equal(readStringAttribute(commandSpan, "correlationId"), command.correlationId);
  assert.equal(readStringAttribute(commandSpan, "trace.baggage"), `correlationId=${command.correlationId}`);
});

function restoreEndpoint(value: string | undefined): void {
  restoreOptionalEnv("OTEL_EXPORTER_OTLP_ENDPOINT", value);
}

function restoreOptionalEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function readOnlySpan(payload: Record<string, unknown>): Record<string, unknown> {
  const resourceSpans = payload["resourceSpans"] as Array<Record<string, unknown>>;
  const scopeSpans = (resourceSpans[0]?.["scopeSpans"] ?? []) as Array<Record<string, unknown>>;
  const spans = (scopeSpans[0]?.["spans"] ?? []) as Array<Record<string, unknown>>;
  const span = spans[0];
  assert.ok(span);
  return span;
}

function readStringAttribute(span: Record<string, unknown>, key: string): string | null {
  const attributes = (span["attributes"] ?? []) as Array<{
    key: string;
    value: { stringValue?: string };
  }>;
  const found = attributes.find((attribute) => attribute.key === key);
  return found?.value.stringValue ?? null;
}
