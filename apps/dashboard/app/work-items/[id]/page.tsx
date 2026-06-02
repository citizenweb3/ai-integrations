import { DEFAULT_WARM_REPLY_INTENT, getWorkItemDetail, type WorkItemDetail } from "@bizdev/db";
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

        {/* Warm reply: the draft is auto-generated when the reply lands, so this
            panel leads with the ready draft (review / regenerate / discard /
            open full editor) — same mechanism as the cold-draft org panel. */}
        {isWarmReply && !isResolved ? (
          <WarmReplyDraftPanel
            draft={item.latestDraft}
            threadId={item.inboundMessage?.threadId ?? null}
            fromEmail={item.inboundMessage?.fromEmail ?? null}
          />
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

// Warm-reply draft panel — mirrors OrgDraftPanel (cold side). The draft is
// auto-generated when the reply is classified, so the common case shows a ready
// draft with review / send / discard / regenerate. Falls back to a one-click
// Generate when none exists yet (old items, post-discard, or auto-gen pending),
// and to an attach prompt when the reply has no thread.
function WarmReplyDraftPanel({
  draft,
  threadId,
  fromEmail
}: {
  draft: WorkItemDetail["latestDraft"];
  threadId: string | null;
  fromEmail: string | null;
}) {
  if (!threadId) {
    return (
      <Card className="border border-yellow-500/30">
        <BlockTitle title="Warm reply" className="mb-2 text-left" />
        <p className="text-sm text-yellow-300">
          This reply isn&apos;t attached to a thread yet — attach it first (see Triage below), then a
          warm draft can be generated.
        </p>
      </Card>
    );
  }

  if (!draft) {
    return (
      <Card className="border border-[var(--accent)]/30">
        <BlockTitle title="Warm reply" className="mb-2 text-left" />
        <p className="text-sm font-light opacity-75 mb-4 max-w-2xl">
          {fromEmail ? `${fromEmail} replied.` : "This contact replied."} A warm draft is normally
          generated automatically — there isn&apos;t one here yet. Generate it now; the agent uses the
          whole thread, this message, and the org&apos;s research. Nothing sends without your approval.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <form action="/api/commands" method="post">
            <input type="hidden" name="commandType" value="generate_warm_draft" />
            <input type="hidden" name="threadId" value={threadId} />
            <input type="hidden" name="replyIntent" value={DEFAULT_WARM_REPLY_INTENT} />
            <Button type="submit" tone="primary">
              Generate warm draft →
            </Button>
          </form>
          <Link href={`/threads/${threadId}`} className="text-xs opacity-60 hover:text-[var(--accent)]">
            open full thread (custom intent, pick recipient) →
          </Link>
        </div>
      </Card>
    );
  }

  const isOpen = draft.status === "draft";
  const isSent =
    draft.status === "sent" ||
    draft.status === "sending" ||
    draft.status === "approved" ||
    draft.status === "approved_pending_send";
  const isFailed = draft.status === "send_failed_post_approve";
  const statusTone = isSent ? "accent" : isFailed ? "danger" : "default";
  const statusLabel = isSent ? "✓ Sent / sending" : isFailed ? "⚠ Send failed" : "Ready for review";

  return (
    <Card className="border border-[var(--accent)]/30">
      <div className="flex justify-between items-start flex-wrap gap-3 mb-4">
        <div>
          <BlockTitle title="Warm reply draft" className="mb-1 text-left" />
          <p className="text-sm opacity-70 font-light">
            <Badge tone={statusTone}>{statusLabel}</Badge>
            {draft.qualityScoreBand ? (
              <span className="ml-2 text-xs opacity-60">quality: {draft.qualityScoreBand}</span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="border border-white/10 rounded-xl p-4 bg-black/20 space-y-2">
        <div className="text-xs opacity-60">
          To: {draft.contactName ? `${draft.contactName} · ` : ""}
          <span className="font-mono">{draft.contactEmail ?? fromEmail ?? "latest sender"}</span>
        </div>
        <div className="text-sm font-medium">{draft.subject}</div>
        {draft.body.length > draft.bodyExcerpt.length ? (
          <details className="group">
            <summary className="list-none cursor-pointer">
              <p className="text-sm font-light opacity-70 whitespace-pre-wrap leading-snug group-open:hidden">
                {draft.bodyExcerpt}…
              </p>
              <span className="text-xs text-[var(--accent)] opacity-80 group-open:hidden">More ▾</span>
              <span className="text-xs text-[var(--accent)] opacity-80 hidden group-open:inline">Less ▴</span>
            </summary>
            <p className="text-sm font-light opacity-70 whitespace-pre-wrap leading-snug mt-1">
              {draft.body}
            </p>
          </details>
        ) : (
          <p className="text-sm font-light opacity-70 whitespace-pre-wrap leading-snug">{draft.body}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <Link
          href={`/drafts/${draft.id}`}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5"
        >
          Open / Edit
        </Link>
        {isOpen ? (
          <>
            <form action="/api/commands" method="post">
              <input type="hidden" name="commandType" value="approve_draft_for_send" />
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="draftVersion" value={String(draft.version)} />
              <button
                type="submit"
                className="rounded-lg bg-[hsl(var(--primary))] text-black font-bold px-4 py-2 text-sm hover:opacity-90"
              >
                Send
              </button>
            </form>
            <form action="/api/commands" method="post">
              <input type="hidden" name="commandType" value="discard_draft" />
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="expectedVersion" value={String(draft.version)} />
              <input type="hidden" name="reason" value="Discarded from work item" />
              <button
                type="submit"
                className="rounded-lg border border-red-500/40 text-red-300 px-4 py-2 text-sm hover:bg-red-500/10"
              >
                Discard
              </button>
            </form>
            <form action="/api/commands" method="post">
              <input type="hidden" name="commandType" value="generate_warm_draft" />
              <input type="hidden" name="threadId" value={threadId} />
              <input type="hidden" name="replaceExisting" value="true" />
              <input type="hidden" name="replyIntent" value={DEFAULT_WARM_REPLY_INTENT} />
              <button
                type="submit"
                className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5"
              >
                Regenerate
              </button>
            </form>
          </>
        ) : null}
      </div>
      <p className="text-xs opacity-50 mt-2">
        Send re-checks pre-send guardrails. Regenerate rewrites the reply from the thread + research.
        For a custom intent or a different recipient, open the{" "}
        <Link href={`/threads/${threadId}`} className="text-[var(--accent)]">
          thread
        </Link>
        .
      </p>
    </Card>
  );
}
