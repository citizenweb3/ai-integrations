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
import { Badge, Button, InfoRow, MetricCard, PageBody, PillLink, textareaClass } from "@/components/ui";
import { BackLink } from "@/components/back-link";

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
  const isWarmReply = item.type === "warm_reply_review_needed";

  return (
    <>
      <ConsoleHero currentNav="inbox"
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
        <div className="flex items-center gap-3 text-sm">
          <BackLink fallbackHref="/inbox" label="← Back" />
          <span className="opacity-40">·</span>
          <span className="opacity-60">Work item detail</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Status" value={item.status} />
          <MetricCard label="Priority" value={priorityBand(item.priority)} accent />
          <div className="rounded-2xl bg-white/5 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
            <div className="text-base font-medium break-words">{item.type}</div>
            <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-2">Type</div>
            <div className="text-xs opacity-60 mt-1 font-light">{item.reasonCode}</div>
          </div>
          <div className="rounded-2xl bg-white/5 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
            <div className="text-base font-medium break-words">{item.sourceEntityType}</div>
            <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-2">Source</div>
            <div className="text-xs opacity-60 mt-1 font-mono break-all">{item.sourceEntityId}</div>
          </div>
        </div>

        {/* Type-specific primary action — what this item actually needs you to
            do. For a warm reply that's writing the response, so the
            generate-warm-draft form lives right here instead of being buried on
            the thread page. The card CTA in the inbox lands the operator here. */}
        {isWarmReply && !isResolved ? (
          <Card className="border border-[var(--accent)]/30">
            <BlockTitle title="Reply to this contact" className="mb-2 text-left" />
            <p className="text-sm font-light opacity-80 mb-4 max-w-2xl">
              {item.inboundMessage?.fromEmail ? `${item.inboundMessage.fromEmail} replied.` : "This contact replied."}{" "}
              Say what your reply should accomplish, then generate a warm draft — the agent writes it
              using the whole thread, this message, and the org&apos;s research. You review and send it
              after; nothing goes out automatically.
            </p>
            {item.inboundMessage?.threadId ? (
              <form action="/api/commands" method="post" className="space-y-3 max-w-2xl">
                <input type="hidden" name="commandType" value="generate_warm_draft" />
                <input type="hidden" name="threadId" value={item.inboundMessage.threadId} />
                <label className="block">
                  <span className="text-xs font-semibold tracking-[0.15em] uppercase opacity-70">
                    What should this reply do?
                  </span>
                  <textarea
                    className={`${textareaClass} mt-2`}
                    name="replyIntent"
                    required
                    rows={4}
                    placeholder="e.g. Confirm we'd love a call next week and propose Tue or Wed 3pm. Ask what their biggest hiring bottleneck is right now."
                  />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" tone="primary">
                    Generate warm draft →
                  </Button>
                  {item.inboundMessage.threadId ? (
                    <Link
                      href={`/threads/${item.inboundMessage.threadId}`}
                      className="text-xs opacity-60 hover:text-[var(--accent)]"
                    >
                      open full thread (pick a different recipient, see history) →
                    </Link>
                  ) : null}
                </div>
                <p className="text-xs font-light opacity-50">
                  Default recipient is whoever sent the latest reply. The draft then shows up under
                  <span className="opacity-80"> Approvals</span> for you to review and send.
                </p>
              </form>
            ) : (
              <p className="text-sm text-yellow-300">
                This reply isn&apos;t attached to a thread yet — attach it first (see Triage below),
                then come back here to generate the draft.
              </p>
            )}
          </Card>
        ) : null}

        {!isResolved ? (
          <Card>
            <BlockTitle title="Queue actions" className="mb-1 text-left" />
            <p className="text-sm font-light opacity-60 mb-4 max-w-2xl">
              Move this item through your queue. These don&apos;t do the task itself — they just say
              what happens to the entry.
            </p>
            <div className="flex flex-wrap gap-2">
              <form action="/api/work-items" method="post">
                <input type="hidden" name="workItemId" value={item.id} />
                <input
                  type="hidden"
                  name="idempotencyKey"
                  value={buildWorkItemActionIdempotencyKey(item.id, "resolve", item.updatedAt)}
                />
                <Button
                  type="submit"
                  name="action"
                  value="resolve"
                  tone="primary"
                  size="sm"
                  title="Done — handled this item, closes it for good"
                >
                  Done
                </Button>
              </form>
              <form action="/api/work-items" method="post">
                <input type="hidden" name="workItemId" value={item.id} />
                <input
                  type="hidden"
                  name="idempotencyKey"
                  value={buildWorkItemActionIdempotencyKey(item.id, "block", item.updatedAt)}
                />
                <Button
                  type="submit"
                  name="action"
                  value="block"
                  tone="ghost"
                  size="sm"
                  title="Can't act yet — keeps it open and surfaces it under the Attention tab"
                >
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
                <Button
                  type="submit"
                  name="action"
                  value="snooze"
                  tone="ghost"
                  size="sm"
                  title="Hide for 1 day, then it comes back to the queue automatically"
                >
                  Later (1d)
                </Button>
              </form>
              <form action="/api/work-items" method="post">
                <input type="hidden" name="workItemId" value={item.id} />
                <input
                  type="hidden"
                  name="idempotencyKey"
                  value={buildWorkItemActionIdempotencyKey(item.id, "dismiss", item.updatedAt)}
                />
                <Button
                  type="submit"
                  name="action"
                  value="dismiss"
                  tone="danger"
                  size="sm"
                  title="Not relevant — closes and drops it (won't come back)"
                >
                  Discard
                </Button>
              </form>
            </div>
            <dl className="mt-5 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="font-semibold text-[var(--accent)] shrink-0">Done</dt>
                <dd className="opacity-60">handled — closes it for good</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-semibold shrink-0">Block</dt>
                <dd className="opacity-60">can't act yet — stays open under Attention</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-semibold shrink-0">Later (1d)</dt>
                <dd className="opacity-60">hides for a day, then comes back</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-semibold text-red-300 shrink-0">Discard</dt>
                <dd className="opacity-60">not relevant — closes and drops it</dd>
              </div>
            </dl>
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
            {item.inboundMessage.attachments.length > 0 ? (
              <div className="mt-4">
                <div className="text-xs uppercase tracking-wider opacity-60 mb-2">Attachments</div>
                <ul className="space-y-1 text-xs">
                  {item.inboundMessage.attachments.map((attachment, index) => (
                    <li key={`${attachment.providerAttachmentId ?? attachment.filename ?? "attachment"}:${index}`} className="break-all">
                      {attachment.filename ?? attachment.providerAttachmentId ?? "unnamed attachment"}
                      {attachment.size !== null ? ` · ${attachment.size} bytes` : ""}
                      {attachment.contentType ? ` · ${attachment.contentType}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
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
