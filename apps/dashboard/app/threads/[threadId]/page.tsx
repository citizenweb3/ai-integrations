import { getThreadDetail } from "@bizdev/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import { Badge, Button, InfoRow, MetricCard, PageBody, inputClass, textareaClass } from "@/components/ui";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ threadId: string }> };

export default async function ThreadDetailPage({ params }: Props) {
  const { threadId } = await params;
  const thread = await getThreadDetail(threadId);

  if (!thread) {
    notFound();
  }

  const canDraftStatus = thread.status === "open" || thread.status === "active";
  const hasInbound = thread.messages.some((m) => m.kind === "inbound");
  const draftDisabled = !canDraftStatus || !hasInbound;
  const contactParticipants = thread.participants.filter((p) => p.contactId);

  return (
    <>
      <ConsoleHero currentNav="inbox"
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            / Thread
          </>
        }
        title="Thread"
        subtitle={thread.id}
      />

      <PageBody>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Status" value={thread.status} />
          <MetricCard label="Campaign" value={thread.campaignId ?? "—"} />
          <div className="rounded-2xl bg-linear-to-t from-[#7C7C81]/25 to-[#1A1A1B]/25 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
            <div className="text-base font-medium break-all">
              {thread.organizationId ? (
                <Link href={`/organizations/${thread.organizationId}`} className="hover:text-[var(--accent)]">
                  {thread.organizationId}
                </Link>
              ) : (
                "—"
              )}
            </div>
            <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-2">Organization</div>
          </div>
          <div className="rounded-2xl bg-linear-to-t from-[#7C7C81]/25 to-[#1A1A1B]/25 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
            <div className="text-base font-medium break-all">{thread.providerThreadKey ?? "—"}</div>
            <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-2">Provider key</div>
          </div>
        </div>

        <Card>
          <BlockTitle title="Generate warm reply" className="mb-4 text-left" />
          <p className="text-sm font-light opacity-80 mb-3">
            Enqueues <code className="font-mono text-xs">job.generate_warm_draft</code> on the{" "}
            <code className="font-mono text-xs">urgent</code> pool; the agent receives the full thread transcript, the
            latest inbound, your reply intent, and the org&apos;s latest{" "}
            <code className="font-mono text-xs">research_snapshot</code>. Default recipient is the sender of the latest
            inbound; override with a contact below.
          </p>
          {!canDraftStatus ? (
            <p className="text-sm text-red-400 mb-3">
              Thread status <code className="font-mono">{thread.status}</code> blocks new outbound traffic.
            </p>
          ) : null}
          {canDraftStatus && !hasInbound ? (
            <p className="text-sm text-red-400 mb-3">No inbound message in this thread yet — nothing to reply to.</p>
          ) : null}
          <form action="/api/commands" method="post" className="space-y-3">
            <input type="hidden" name="commandType" value="generate_warm_draft" />
            <input type="hidden" name="threadId" value={thread.id} />
            <textarea
              className={textareaClass}
              name="replyIntent"
              placeholder="Reply intent: what should this reply accomplish? (e.g. confirm meeting Tue 3pm, push back on pricing, ask for the ICP doc)"
              required
              rows={5}
              disabled={draftDisabled}
            />
            {contactParticipants.length > 0 ? (
              <select className={inputClass} name="targetContactId" defaultValue="" disabled={draftDisabled}>
                <option value="">Default recipient (latest inbound sender)</option>
                {contactParticipants.map((p) => (
                  <option key={p.id} value={p.contactId ?? ""}>
                    {p.email} ({p.role})
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={inputClass}
                name="targetContactId"
                placeholder="Target contact ID (UUID, optional)"
                disabled={draftDisabled}
              />
            )}
            <Button type="submit">Generate warm draft</Button>
          </form>
        </Card>

        <Card>
          <BlockTitle title="Participants" className="mb-4 text-left" />
          {thread.participants.length === 0 ? (
            <p className="text-sm font-light opacity-60">No participants recorded yet.</p>
          ) : (
            <ul className="space-y-1">
              {thread.participants.map((p) => (
                <li
                  key={p.id}
                  className="flex justify-between gap-3 border-b border-white/10 py-2 last:border-b-0 text-sm"
                >
                  <strong className="font-medium break-all">{p.email}</strong>
                  <Badge>{p.role}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <BlockTitle title="Messages" className="mb-4 text-left" />
          {thread.messages.length === 0 ? (
            <p className="text-sm font-light opacity-60">No messages in this thread.</p>
          ) : (
            <ul className="space-y-3">
              {thread.messages.map((m) => (
                <li
                  key={`${m.kind}:${m.id}`}
                  className="border border-white/10 rounded-xl p-4 bg-black/30 space-y-2"
                >
                  <div className="flex justify-between gap-3 items-baseline">
                    <strong className="font-medium break-all">
                      {m.kind === "inbound" ? `← ${m.fromEmail}` : `→ ${m.recipientEmail}`}
                    </strong>
                    <span className="text-xs opacity-60 whitespace-nowrap">
                      {m.kind === "outbound" ? `${m.provider} · ${m.status} · ` : ""}
                      {m.at.toISOString()}
                    </span>
                  </div>
                  {m.subject ? <div className="text-xs opacity-60">Subject: {m.subject}</div> : null}
                  {m.kind === "inbound" && m.attachments.length > 0 ? (
                    <ul className="space-y-1 text-xs opacity-80">
                      {m.attachments.map((attachment, index) => (
                        <li key={`${attachment.providerAttachmentId ?? attachment.filename ?? "attachment"}:${index}`} className="break-all">
                          {attachment.filename ?? attachment.providerAttachmentId ?? "unnamed attachment"}
                          {attachment.size !== null ? ` · ${attachment.size} bytes` : ""}
                          {attachment.contentType ? ` · ${attachment.contentType}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {(m.kind === "inbound" ? m.rawText : m.body) ? (
                    <pre className="m-0 p-3 bg-black/40 rounded-lg text-xs whitespace-pre-wrap break-words font-mono max-h-80 overflow-auto">
                      {m.kind === "inbound" ? m.rawText : m.body}
                    </pre>
                  ) : (
                    <span className="text-xs opacity-60">No body captured.</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <BlockTitle title="Timestamps" className="mb-4 text-left" />
          <InfoRow label="Created" value={thread.createdAt.toISOString()} />
          <InfoRow label="Updated" value={thread.updatedAt.toISOString()} />
        </Card>
      </PageBody>
    </>
  );
}
