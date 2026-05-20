import { getOperationsEventFeed, type OperationsEventFeedRow } from "@bizdev/db";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import { Badge, Button, PageBody, PillLink, inputClass } from "@/components/ui";
import OperationsEventsAutoRefresh from "./auto-refresh";

export const dynamic = "force-dynamic";

const FEED_LIMIT = 500;

type Props = {
  searchParams: Promise<{
    eventType?: string | string[];
    correlationId?: string | string[];
    from?: string | string[];
    to?: string | string[];
  }>;
};

function parseString(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  const trimmed = candidate?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function fmtDate(value: Date | null): string {
  if (!value) return "";
  return value.toISOString().slice(0, 19).replace("T", " ");
}

function fmtInputDate(value: Date | null): string {
  if (!value) return "";
  return value.toISOString().slice(0, 16);
}

function shortId(value: string | null): string {
  return value ? value.slice(0, 8) : "-";
}

function payloadPreview(value: Record<string, unknown>): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized.length > 900 ? `${serialized.slice(0, 900)}\n...` : serialized;
}

function eventLink(row: OperationsEventFeedRow): string {
  const params = new URLSearchParams({ correlationId: row.correlationId });
  return `/operations/events?${params.toString()}`;
}

export default async function OperationsEventsPage({ searchParams }: Props) {
  const params = await searchParams;
  const feed = await getOperationsEventFeed({
    eventType: parseString(params.eventType) ?? null,
    correlationId: parseString(params.correlationId) ?? null,
    from: parseString(params.from) ?? null,
    to: parseString(params.to) ?? null,
    limit: FEED_LIMIT
  });
  const activeFilterCount = [
    feed.filters.eventType,
    feed.filters.correlationId,
    feed.filters.from,
    feed.filters.to
  ].filter(Boolean).length;

  return (
    <>
      <OperationsEventsAutoRefresh intervalMs={5000} />
      <ConsoleHero
        eyebrow={
          <>
            <Link href="/operations" className="text-[hsl(var(--primary))]">
              Operations
            </Link>{" "}
            / Events
          </>
        }
        title="Event Feed"
        subtitle={`Last ${feed.filters.limit} matching event_log rows. Snapshot generated at ${feed.generatedAt.toISOString()}.`}
      />

      <PageBody>
        <div className="flex flex-wrap gap-2">
          <PillLink href="/operations">Overview</PillLink>
          <PillLink href="/operations/events" primary={activeFilterCount === 0}>
            Event feed
          </PillLink>
        </div>

        <Card>
          <BlockTitle title="Filters" className="mb-4 text-left" />
          <form method="get" className="grid gap-4 lg:grid-cols-[minmax(180px,240px)_1fr_180px_180px_auto_auto] lg:items-end">
            <label className="block text-sm">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] opacity-60">Event type</span>
              <select name="eventType" defaultValue={feed.filters.eventType ?? ""} className={inputClass}>
                <option value="">All events</option>
                {feed.eventTypes.map((eventType) => (
                  <option key={eventType} value={eventType}>
                    {eventType}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] opacity-60">Correlation ID</span>
              <input
                name="correlationId"
                defaultValue={feed.filters.correlationId ?? ""}
                placeholder="8b4b8f7d-..."
                className={inputClass}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] opacity-60">From</span>
              <input
                name="from"
                type="datetime-local"
                defaultValue={fmtInputDate(feed.filters.from)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] opacity-60">To</span>
              <input
                name="to"
                type="datetime-local"
                defaultValue={fmtInputDate(feed.filters.to)}
                className={inputClass}
              />
            </label>
            <Button type="submit" className="whitespace-nowrap">
              Apply
            </Button>
            <PillLink href="/operations/events" className="text-center">
              Reset
            </PillLink>
          </form>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Badge tone={activeFilterCount > 0 ? "primary" : "default"}>{activeFilterCount} active filters</Badge>
            <Badge tone="accent">refresh 5s</Badge>
            {!feed.filters.correlationIdValid ? (
              <Badge tone="danger">invalid correlation ID</Badge>
            ) : null}
          </div>
        </Card>

        <Card>
          <BlockTitle title={`Events (${feed.rows.length})`} className="mb-4 text-left" />
          {feed.rows.length === 0 ? (
            <p className="text-sm font-light opacity-60">No events match the current filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-left uppercase tracking-wider opacity-60">
                    <th className="py-2 pr-3 font-medium">Created</th>
                    <th className="py-2 pr-3 font-medium">Event</th>
                    <th className="py-2 pr-3 font-medium">Correlation</th>
                    <th className="py-2 pr-3 font-medium">Entity</th>
                    <th className="py-2 pr-3 font-medium">Command / job</th>
                    <th className="py-2 font-medium">Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {feed.rows.map((row) => (
                    <tr key={row.id} className="border-b border-white/5 align-top">
                      <td className="py-3 pr-3 whitespace-nowrap opacity-80">{fmtDate(row.createdAt)}</td>
                      <td className="py-3 pr-3 font-mono text-[11px]">{row.eventType}</td>
                      <td className="py-3 pr-3 font-mono text-[11px]">
                        <Link href={eventLink(row)} className="text-[var(--accent)] hover:opacity-80">
                          {shortId(row.correlationId)}
                        </Link>
                      </td>
                      <td className="py-3 pr-3">
                        {row.entityType ? (
                          <>
                            <div>{row.entityType}</div>
                            <div className="font-mono text-[11px] opacity-60">{shortId(row.entityId)}</div>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="py-3 pr-3 font-mono text-[11px] opacity-80">
                        <div>cmd {shortId(row.commandId)}</div>
                        <div>job {shortId(row.jobId)}</div>
                      </td>
                      <td className="py-3">
                        <pre className="max-w-[520px] whitespace-pre-wrap break-words rounded-md border border-white/10 bg-black/20 p-3 font-mono text-[11px] leading-relaxed opacity-80">
                          {payloadPreview(row.payloadJson)}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </PageBody>
    </>
  );
}
