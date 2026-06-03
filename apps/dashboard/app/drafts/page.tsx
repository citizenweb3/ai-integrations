import { getDraftsList, type DraftListRow } from "@bizdev/db";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import { Badge, Button, PageBody, inputClass, textareaClass } from "@/components/ui";
import { SideDrawer } from "@/components/side-drawer";

export const dynamic = "force-dynamic";

// Group the flat draft list into one bucket per campaign, preserving the
// newest-first order getDraftsList already returns: the first draft seen
// for a campaign fixes that campaign's position, so the campaign with the
// most-recently-touched draft sorts to the top. Drafts with no campaign
// (legacy / deleted campaign row) collect into a trailing "No campaign"
// bucket.
type DraftGroup = {
  campaignId: string | null;
  campaignName: string | null;
  drafts: DraftListRow[];
};

function groupDraftsByCampaign(rows: DraftListRow[]): DraftGroup[] {
  const byCampaign = new Map<string, DraftGroup>();
  const orphans: DraftListRow[] = [];
  for (const row of rows) {
    if (!row.campaignId) {
      orphans.push(row);
      continue;
    }
    const existing = byCampaign.get(row.campaignId);
    if (existing) {
      existing.drafts.push(row);
    } else {
      byCampaign.set(row.campaignId, {
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        drafts: [row]
      });
    }
  }
  const groups = [...byCampaign.values()];
  if (orphans.length > 0) {
    groups.push({ campaignId: null, campaignName: null, drafts: orphans });
  }
  return groups;
}

export default async function DraftsListPage() {
  const drafts = await getDraftsList();
  const groups = groupDraftsByCampaign(drafts);

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
        subtitle="All operator and agent drafts. Approve before send."
      />

      <PageBody>
        {/* T-026BI: manual draft creation moved off the top of the list into
            a drawer. Most drafts auto-generate now; the by-hand form is a
            fallback, one click away, so the list stays the focus. */}
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

        {/* Drafts grouped into one card per campaign so the operator sees
            them organised by the campaign that produced them, and can jump
            straight to a campaign's page. */}
        {groups.length === 0 ? (
          <Card>
            <p className="text-sm font-light opacity-60">No drafts yet.</p>
          </Card>
        ) : (
          groups.map((group) => (
            <Card key={group.campaignId ?? "__none"}>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <BlockTitle
                    title={group.campaignName ?? "No campaign"}
                    className="text-left"
                  />
                  <Badge tone="accent">{group.drafts.length}</Badge>
                </div>
                {group.campaignId ? (
                  <Link
                    href={`/campaigns/${group.campaignId}`}
                    className="shrink-0 text-xs font-semibold tracking-[0.18em] uppercase text-[var(--accent)] hover:opacity-80 transition-opacity"
                  >
                    Open campaign →
                  </Link>
                ) : null}
              </div>
              <ul className="space-y-3">
                {group.drafts.map((d) => (
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
            </Card>
          ))
        )}
      </PageBody>
    </>
  );
}
