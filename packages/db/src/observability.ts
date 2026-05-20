import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "./client";

export type PrometheusMetricRow = {
  label: string;
  value: number;
};

export type PrometheusMetricsSnapshot = {
  generatedAt: Date;
  jobsQueuedByType: PrometheusMetricRow[];
  jobsDeadLetteredByType: PrometheusMetricRow[];
  workersHealthy: number;
  webhooksBacklog: number;
  outboundSentTotal: number;
  outboundFailedTotal: number;
};

type CountRow = {
  label: string;
  count: number;
};

export async function getPrometheusMetricsSnapshot(): Promise<PrometheusMetricsSnapshot> {
  const db = getDb();
  const [
    queuedRows,
    deadLetteredRows,
    healthyWorkerRows,
    webhookBacklogRows,
    outboundSentRows,
    outboundFailedRows
  ] = await Promise.all([
    db.execute(sql`
      select job_type as label, count(*)::int as count
      from jobs
      where status = 'queued'
      group by job_type
      order by job_type
    `),
    db.execute(sql`
      select job_type as label, count(*)::int as count
      from jobs
      where status = 'dead_lettered'
      group by job_type
      order by job_type
    `),
    db.execute(sql`
      select count(*)::int as count
      from worker_heartbeats
      where status = 'running'
        and last_seen_at >= now() - interval '30 seconds'
    `),
    db.execute(sql`
      select count(*)::int as count
      from webhook_events
      where status in ('received', 'queued_for_processing', 'processing', 'processing_failed')
    `),
    db.execute(sql`
      select count(*)::int as count
      from outbound_messages
      where status = 'sent'
    `),
    db.execute(sql`
      select count(*)::int as count
      from outbound_messages
      where status = 'send_failed'
    `)
  ]);

  return {
    generatedAt: new Date(),
    jobsQueuedByType: mapCountRows(queuedRows),
    jobsDeadLetteredByType: mapCountRows(deadLetteredRows),
    workersHealthy: readSingleCount(healthyWorkerRows),
    webhooksBacklog: readSingleCount(webhookBacklogRows),
    outboundSentTotal: readSingleCount(outboundSentRows),
    outboundFailedTotal: readSingleCount(outboundFailedRows)
  };
}

export function renderPrometheusMetrics(snapshot: PrometheusMetricsSnapshot): string {
  const lines: string[] = [];
  appendMetricFamily(lines, {
    name: "bizdev_jobs_queued",
    help: "Current queued jobs by job type.",
    type: "gauge",
    samples: snapshot.jobsQueuedByType.map((row) => ({
      labels: { job_type: row.label },
      value: row.value
    }))
  });
  appendMetricFamily(lines, {
    name: "bizdev_jobs_dead_lettered",
    help: "Current dead-lettered jobs by job type.",
    type: "gauge",
    samples: snapshot.jobsDeadLetteredByType.map((row) => ({
      labels: { job_type: row.label },
      value: row.value
    }))
  });
  appendMetricFamily(lines, {
    name: "bizdev_workers_healthy",
    help: "Workers with a fresh running heartbeat.",
    type: "gauge",
    samples: [{ value: snapshot.workersHealthy }]
  });
  appendMetricFamily(lines, {
    name: "bizdev_webhooks_backlog",
    help: "Webhook events still in received, queued, processing, or failed-processing states.",
    type: "gauge",
    samples: [{ value: snapshot.webhooksBacklog }]
  });
  appendMetricFamily(lines, {
    name: "bizdev_outbound_sent_total",
    help: "Outbound messages currently marked sent.",
    type: "counter",
    samples: [{ value: snapshot.outboundSentTotal }]
  });
  appendMetricFamily(lines, {
    name: "bizdev_outbound_failed_total",
    help: "Outbound messages currently marked send_failed.",
    type: "counter",
    samples: [{ value: snapshot.outboundFailedTotal }]
  });
  lines.push(`# EOF generated_at=${snapshot.generatedAt.toISOString()}`);
  return `${lines.join("\n")}\n`;
}

type MetricSample = {
  labels?: Record<string, string>;
  value: number;
};

function appendMetricFamily(
  lines: string[],
  input: {
    name: string;
    help: string;
    type: "counter" | "gauge";
    samples: MetricSample[];
  }
): void {
  lines.push(`# HELP ${input.name} ${input.help}`);
  lines.push(`# TYPE ${input.name} ${input.type}`);
  for (const sample of input.samples) {
    lines.push(`${input.name}${formatLabels(sample.labels)} ${formatMetricValue(sample.value)}`);
  }
}

function formatLabels(labels: Record<string, string> | undefined): string {
  if (!labels || Object.keys(labels).length === 0) return "";
  const pairs = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}="${escapePrometheusLabel(value)}"`);
  return `{${pairs.join(",")}}`;
}

function escapePrometheusLabel(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, "\\\"");
}

function formatMetricValue(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

function mapCountRows(rows: unknown): PrometheusMetricRow[] {
  return (rows as CountRow[]).map((row) => ({
    label: row.label,
    value: row.count
  }));
}

function readSingleCount(rows: unknown): number {
  const [row] = rows as Array<{ count: number }>;
  return row?.count ?? 0;
}

export type TraceAttributes = Record<string, string | number | boolean | null | undefined>;

export type TraceOperationInput = {
  serviceName: "dashboard" | "worker" | "test";
  name: string;
  kind?: "internal" | "server" | "consumer";
  correlationId?: string | null;
  attributes?: TraceAttributes;
};

export type TraceSpanHandle = {
  setAttribute(key: string, value: string | number | boolean | null | undefined): void;
  setBaggage(key: string, value: string | null | undefined): void;
};

export type TraceBaggage = Record<string, string>;

type TraceContext = {
  traceId: string;
  spanId: string;
  baggage: TraceBaggage;
};

type CompletedSpan = {
  serviceName: string;
  name: string;
  kind: number;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Record<string, string | number | boolean>;
  errorMessage: string | null;
};

type OtlpExporter = (endpoint: string, payload: Record<string, unknown>) => Promise<void>;

const traceStorage = new AsyncLocalStorage<TraceContext>();
let otlpExporter: OtlpExporter = defaultOtlpExporter;

export async function traceOperation<T>(
  input: TraceOperationInput,
  callback: (span: TraceSpanHandle) => Promise<T> | T
): Promise<T> {
  const parent = traceStorage.getStore();
  const baggage: TraceBaggage = { ...(parent?.baggage ?? {}) };
  if (input.correlationId) {
    baggage.correlationId = input.correlationId;
  }

  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input.attributes ?? {})) {
    if (value !== undefined && value !== null) {
      attributes[key] = value;
    }
  }
  if (input.correlationId) {
    attributes.correlationId = input.correlationId;
  }

  const context: TraceContext = {
    traceId: parent?.traceId ?? randomHex(16),
    spanId: randomHex(8),
    baggage
  };
  const handle: TraceSpanHandle = {
    setAttribute(key, value) {
      if (value === undefined || value === null) {
        delete attributes[key];
      } else {
        attributes[key] = value;
      }
    },
    setBaggage(key, value) {
      if (value === undefined || value === null || value.length === 0) {
        delete baggage[key];
      } else {
        baggage[key] = value;
      }
    }
  };
  const startTimeUnixNano = unixNanoNow();
  let errorMessage: string | null = null;

  return traceStorage.run(context, async () => {
    try {
      return await callback(handle);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      const baggageHeader = formatTraceBaggage(baggage);
      if (baggageHeader) {
        attributes["trace.baggage"] = baggageHeader;
      }
      await exportCompletedSpan({
        serviceName: input.serviceName,
        name: input.name,
        kind: spanKind(input.kind ?? "internal"),
        traceId: context.traceId,
        spanId: context.spanId,
        parentSpanId: parent?.spanId ?? null,
        startTimeUnixNano,
        endTimeUnixNano: unixNanoNow(),
        attributes,
        errorMessage
      });
    }
  });
}

export function getTraceBaggage(): TraceBaggage {
  return { ...(traceStorage.getStore()?.baggage ?? {}) };
}

export function isOtlpExporterEnabled(): boolean {
  return readOtlpTraceEndpoint() !== null;
}

export function configureOtlpExporterForTest(exporter: OtlpExporter): () => void {
  const previous = otlpExporter;
  otlpExporter = exporter;
  return () => {
    otlpExporter = previous;
  };
}

async function exportCompletedSpan(span: CompletedSpan): Promise<void> {
  const endpoint = readOtlpTraceEndpoint();
  if (!endpoint) return;

  const payload = buildOtlpTracePayload(span);
  try {
    await otlpExporter(endpoint, payload);
  } catch {
    // Telemetry export must never affect command/job execution.
  }
}

function buildOtlpTracePayload(span: CompletedSpan): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            otlpStringAttribute("service.name", span.serviceName)
          ]
        },
        scopeSpans: [
          {
            scope: { name: "bizdev-email-agent" },
            spans: [
              {
                traceId: span.traceId,
                spanId: span.spanId,
                ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
                name: span.name,
                kind: span.kind,
                startTimeUnixNano: span.startTimeUnixNano,
                endTimeUnixNano: span.endTimeUnixNano,
                attributes: Object.entries(span.attributes).map(([key, value]) =>
                  otlpAttribute(key, value)
                ),
                status: span.errorMessage
                  ? { code: 2, message: span.errorMessage }
                  : { code: 1 }
              }
            ]
          }
        ]
      }
    ]
  };
}

function otlpAttribute(key: string, value: string | number | boolean): Record<string, unknown> {
  if (typeof value === "boolean") {
    return { key, value: { boolValue: value } };
  }
  if (typeof value === "number") {
    return { key, value: { doubleValue: value } };
  }
  return otlpStringAttribute(key, value);
}

function otlpStringAttribute(key: string, value: string): Record<string, unknown> {
  return { key, value: { stringValue: value } };
}

async function defaultOtlpExporter(endpoint: string, payload: Record<string, unknown>): Promise<void> {
  await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

function readOtlpTraceEndpoint(): string | null {
  const raw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!raw) return null;
  return raw.endsWith("/v1/traces")
    ? raw
    : `${raw.replace(/\/+$/, "")}/v1/traces`;
}

function spanKind(kind: NonNullable<TraceOperationInput["kind"]>): number {
  if (kind === "server") return 2;
  if (kind === "consumer") return 5;
  return 1;
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function unixNanoNow(): string {
  return String(BigInt(Date.now()) * 1_000_000n);
}

function formatTraceBaggage(baggage: TraceBaggage): string {
  return Object.entries(baggage)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join(",");
}
