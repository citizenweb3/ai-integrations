import { getDraftsList } from "@bizdev/db";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import { Badge, Button, PageBody, inputClass, textareaClass } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DraftsListPage() {
  const drafts = await getDraftsList();

  return (
    <>
      <ConsoleHero
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            / Drafts
          </>
        }
        title="Drafts"
        subtitle="All operator and agent drafts. Approve before send."
      />

      <PageBody>
        <Card>
          <BlockTitle title="Create draft" className="mb-4 text-left" />
          <form action="/api/commands" method="post" className="space-y-3">
            <input type="hidden" name="commandType" value="create_draft" />
            <input className={inputClass} name="subject" placeholder="Subject" required />
            <textarea className={textareaClass} name="body" placeholder="Body" required rows={8} />
            <input className={inputClass} name="recipientEmail" type="email" placeholder="Recipient email (optional)" />
            <input className={inputClass} name="fromEmail" type="email" placeholder="From email (optional)" />
            <input className={inputClass} name="campaignId" placeholder="Campaign ID (UUID, optional)" />
            <input className={inputClass} name="threadId" placeholder="Thread ID (UUID, optional)" />
            <input className={inputClass} name="contactId" placeholder="Contact ID (UUID, optional)" />
            <textarea className={textareaClass} name="notes" placeholder="Operator notes (optional)" />
            <Button type="submit">Create draft</Button>
          </form>
        </Card>

        <Card>
          <BlockTitle title={`Recent drafts (${drafts.length})`} className="mb-4 text-left" />
          {drafts.length === 0 ? (
            <p className="text-sm font-light opacity-60">No drafts yet.</p>
          ) : (
            <ul className="space-y-3">
              {drafts.map((d) => (
                <li key={d.id} className="border border-white/10 rounded-xl p-4 bg-black/30">
                  <div className="flex justify-between items-start gap-3 mb-2">
                    <Link
                      href={`/drafts/${d.id}`}
                      className="text-base font-medium hover:text-[var(--accent)] hover:no-underline flex-1 min-w-0 break-words"
                    >
                      {d.subject}
                    </Link>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge tone="accent">v{d.version}</Badge>
                      <Badge>{d.status}</Badge>
                    </div>
                  </div>
                  <div className="text-xs opacity-60">
                    {d.contactEmail ?? "no contact"}
                    {d.threadId ? ` · thread ${d.threadId}` : ""}
                    {" · updated "}
                    {d.updatedAt.toISOString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </PageBody>
    </>
  );
}
