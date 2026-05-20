import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  closeDb,
  configureOtlpExporterForTest,
  getTraceBaggage,
  isOtlpExporterEnabled,
  traceOperation
} from "../src";

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

function restoreEndpoint(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  } else {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = value;
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
