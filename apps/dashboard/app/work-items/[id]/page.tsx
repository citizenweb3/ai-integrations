import { getWorkItemDetail } from "@bizdev/db";
import {
  buildAttachInboundToThreadIdempotencyKey,
  buildWorkItemActionIdempotencyKey
} from "@bizdev/shared";
import { notFound } from "next/navigation";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import { Badge, Button, InfoRow, MetricCard, PageBody, PillLink } from "@/components/ui";

export const dynamic = "force-dynamic";

function priorityBand(priority: number) {
  if (priority >= 90) return "P0";
  if (priority >= 70) return "P1";
  if (priority >= 40) return "P2";
  return "P3";
}

type Props = { params: Promise<{ id: string }> };

export default async function WorkItemDetailPage({ params }: Props) {
  const { id } = await params;
  const item = await getWorkItemDetail(id);

  if (!item) {
    notFound();
  }

  const isResolved =
    item.status === "resolved" || item.status === "dismissed" || item.status === "superseded";

  return (
    <>
      <ConsoleHero
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            / Work Item
          </>
        }
        title={item.title}
        subtitle={item.summary ?? undefined}
      />

      <PageBody>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Status" value={item.status} />
          <MetricCard label="Priority" value={priorityBand(item.priority)} accent />
          <div className="rounded-2xl bg-linear-to-t from-[#7C7C81]/25 to-[#1A1A1B]/25 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
            <div className="text-base font-medium break-words">{item.type}</div>
            <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-2">Type</div>
            <div className="text-xs opacity-60 mt-1 font-light">{item.reasonCode}</div>
          </div>
          <div className="rounded-2xl bg-linear-to-t from-[#7C7C81]/25 to-[#1A1A1B]/25 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
            <div className="text-base font-medium break-words">{item.sourceEntityType}</div>
            <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-2">Source</div>
            <div className="text-xs opacity-60 mt-1 font-mono break-all">{item.sourceEntityId}</div>
          </div>
        </div>

        {!isResolved ? (
          <Card>
            <BlockTitle title="Actions" className="mb-4 text-left" />
            <div className="flex flex-wrap gap-2">
              <form action="/api/work-items" method="post">
                <input type="hidden" name="workItemId" value={item.id} />
                <input
                  type="hidden"
                  name="idempotencyKey"
                  value={buildWorkItemActionIdempotencyKey(item.id, "resolve", item.updatedAt)}
                />
                <Button type="submit" name="action" value="resolve" tone="primary" size="sm">
                  Resolve
                </Button>
              </form>
              <form action="/api/work-items" method="post">
                <input type="hidden" name="workItemId" value={item.id} />
                <input
                  type="hidden"
                  name="idempotencyKey"
                  value={buildWorkItemActionIdempotencyKey(item.id, "block", item.updatedAt)}
                />
                <Button type="submit" name="action" value="block" tone="ghost" size="sm">
                  Block
                </Button>
              </form>
              <form action="/api/work-items" method="post">
                <input type="hidden" name="workItemId" value={item.id} />
                <input
                  type="hidden"
                  name="idempotencyKey"
                  value={buildWorkItemActionIdempotencyKey(item.id, "snooze", item.updatedAt)}
                />
                <input type="hidden" name="snoozeMinutes" value="1440" />
                <Button type="submit" name="action" value="snooze" tone="ghost" size="sm">
                  Snooze 1d
                </Button>
              </form>
              <form action="/api/work-items" method="post">
                <input type="hidden" name="workItemId" value={item.id} />
                <input
                  type="hidden"
                  name="idempotencyKey"
                  value={buildWorkItemActionIdempotencyKey(item.id, "dismiss", item.updatedAt)}
                />
                <Button type="submit" name="action" value="dismiss" tone="danger" size="sm">
                  Dismiss
                </Button>
              </form>
            </div>
          </Card>
        ) : null}

        {item.draftId ? (
          <Card>
            <BlockTitle title="Draft" className="mb-4 text-left" />
            <PillLink href={`/drafts/${item.draftId}`} primary>
              Open draft review
            </PillLink>
          </Card>
        ) : null}

        {item.inboundMessage ? (
          <Card>
            <BlockTitle title="Inbound Message" className="mb-4 text-left" />
            <InfoRow label="From" value={item.inboundMessage.fromEmail} />
            <InfoRow
              label="Thread"
              value={
                item.inboundMessage.threadId ? (
                  <Link
                    href={`/threads/${item.inboundMessage.threadId}`}
                    className="hover:text-[var(--accent)] break-all"
                  >
                    {item.inboundMessage.threadId}
                  </Link>
                ) : (
                  "Not attached"
                )
              }
            />
            {item.inboundMessage.subject ? (
              <InfoRow label="Subject" value={item.inboundMessage.subject} />
            ) : null}
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider opacity-60 mb-2">Body</div>
              {item.inboundMessage.rawText ? (
                <pre className="m-0 p-3 bg-black/40 rounded-lg text-xs whitespace-pre-wrap break-words font-mono max-h-96 overflow-auto">
                  {item.inboundMessage.rawText}
                </pre>
              ) : (
                <span className="text-xs opacity-60">No body text captured.</span>
              )}
            </div>
          </Card>
        ) : null}

        {item.inboundMessage && !item.inboundMessage.threadId && !isResolved ? (
          <Card>
            <BlockTitle title="Triage" className="mb-4 text-left" />
            <p className="text-sm font-light opacity-80 mb-3">
              Attach this inbound message to a thread. A new thread is created if no existing thread is selected.
            </p>
            <form action="/api/commands" method="post">
              <input type="hidden" name="commandType" value="attach_inbound_to_thread" />
              <input type="hidden" name="inboundMessageId" value={item.inboundMessage.id} />
              <input type="hidden" name="createNewThread" value="1" />
              <input
                type="hidden"
                name="idempotencyKey"
                value={buildAttachInboundToThreadIdempotencyKey(
                  item.inboundMessage.id,
                  "new",
                  item.inboundMessage.createdAt
                )}
              />
              <Button type="submit" size="sm">
                Attach to new thread
              </Button>
            </form>
          </Card>
        ) : null}

        {item.webhookEvent ? (
          <Card>
            <BlockTitle title="Webhook Event" className="mb-4 text-left" />
            <InfoRow label="Event type" value={<Badge>{item.webhookEvent.eventType}</Badge>} />
            <InfoRow label="Status" value={item.webhookEvent.status} />
            <InfoRow label="Received" value={item.webhookEvent.createdAt.toISOString()} />
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider opacity-60 mb-2">Raw payload</div>
              <pre className="m-0 p-3 bg-black/40 rounded-lg text-xs whitespace-pre-wrap break-words font-mono max-h-80 overflow-auto">
                {JSON.stringify(item.webhookEvent.rawBodyJson, null, 2)}
              </pre>
            </div>
          </Card>
        ) : null}

        <Card>
          <BlockTitle title="Timestamps" className="mb-4 text-left" />
          <InfoRow label="Created" value={item.createdAt.toISOString()} />
          <InfoRow label="Updated" value={item.updatedAt.toISOString()} />
          {item.resolvedAt ? <InfoRow label="Resolved" value={item.resolvedAt.toISOString()} /> : null}
        </Card>
      </PageBody>
    </>
  );
}
