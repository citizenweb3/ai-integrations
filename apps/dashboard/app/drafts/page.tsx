import { getCampaignsWithDraftCounts } from "@bizdev/db";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import { Badge, Button, PageBody, inputClass, textareaClass } from "@/components/ui";
import { SideDrawer } from "@/components/side-drawer";
import { formatRelativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// The /drafts page is an index of campaigns that have produced drafts.
// Each card drills into /campaigns/[id]/drafts, where the operator sees
// the drafts for that campaign only, paginated. This keeps the surface
// readable once campaigns produce dozens of drafts each.
export default async function DraftsListPage() {
  const campaigns = await getCampaignsWithDraftCounts();

  return (
    <>
      <ConsoleHero currentNav="drafts"
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            / Drafts
          </>
        }
        title="Drafts"
        subtitle="Drafts grouped by campaign. Open a campaign to review and send its drafts."
      />

      <PageBody>
        {/* T-026BI: manual draft creation lives in a drawer; most drafts
            auto-generate, the by-hand form is a one-click fallback. */}
        <div>
          <SideDrawer
            triggerLabel="Create manual draft"
            description="Write a one-off draft by hand (subject, body, recipient). Most drafts generate automatically — this is the fallback."
            title="Create manual draft"
          >
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
          </SideDrawer>
        </div>

        {campaigns.length === 0 ? (
          <Card>
            <p className="text-sm font-light opacity-60">
              No drafts yet. Drafts generate automatically once a campaign has an
              organisation with a published research snapshot and an addressable
              contact.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {campaigns.map((c) => (
              <Link
                key={c.id}
                href={`/campaigns/${c.id}/drafts`}
                className="block hover:no-underline"
              >
                <Card className="h-full hover:bg-white/10 transition-colors">
                  <div className="flex items-start justify-between gap-4 mb-6">
                    <h3 className="text-xl font-bold tracking-[0.02em] min-w-0 break-words">
                      {c.name}
                    </h3>
                    <Badge tone="accent">{c.draftCount}</Badge>
                  </div>
                  <div className="text-3xl font-bold">{c.draftCount}</div>
                  <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-1">
                    {c.draftCount === 1 ? "draft" : "drafts"}
                  </div>
                  <div className="flex items-center justify-between mt-6 text-xs">
                    <span className="opacity-50">
                      {c.lastDraftAt
                        ? `updated ${formatRelativeTime(c.lastDraftAt)}`
                        : ""}
                    </span>
                    <span className="font-semibold tracking-[0.18em] uppercase text-[var(--accent)]">
                      Open →
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
