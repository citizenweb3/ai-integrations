import {
  countDraftsForCampaign,
  getCampaignDiscoveryView,
  getDraftsForCampaign,
  getSendableDraftsForCampaign
} from "@bizdev/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import { Badge, PageBody } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { SendAllDraftsDrawer } from "@/components/send-all-drafts-drawer";

// Dedicated, paginated drafts page for a single campaign. Reached by
// drilling into a campaign card on /drafts. Shows only this campaign's
// drafts plus the bulk "Send all" action.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

export default async function CampaignDraftsPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const view = await getCampaignDiscoveryView(id);
  if (!view) {
    notFound();
  }

  const total = await countDraftsForCampaign(id);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rawPage = Array.isArray(query["page"]) ? query["page"][0] : query["page"];
  const parsedPage = Number.parseInt(rawPage ?? "1", 10);
  const page = Number.isNaN(parsedPage)
    ? 1
    : Math.min(Math.max(1, parsedPage), totalPages);

  const drafts = await getDraftsForCampaign(id, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE
  });
  const sendableDrafts = await getSendableDraftsForCampaign(id);

  return (
    <>
      <ConsoleHero
        currentNav="drafts"
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            /{" "}
            <Link href="/drafts" className="text-[hsl(var(--primary))]">
              Drafts
            </Link>{" "}
            /{" "}
            <Link
              href={`/campaigns/${view.campaign.id}`}
              className="text-[hsl(var(--primary))]"
            >
              {view.campaign.name}
            </Link>
          </>
        }
        title={`Drafts · ${view.campaign.name}`}
        subtitle={`${total} draft${total === 1 ? "" : "s"} for this campaign. Review each before sending; use "Send all drafts" to approve them in one pass.`}
      />

      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/drafts"
            className="text-sm opacity-70 hover:opacity-100 underline decoration-dotted"
          >
            ← All campaigns
          </Link>
          <SendAllDraftsDrawer drafts={sendableDrafts} />
        </div>

        {total === 0 ? (
          <Card>
            <p className="text-sm font-light opacity-70">
              No drafts yet for this campaign. Drafts generate automatically once
              an organisation has a published research snapshot and an addressable
              contact.
            </p>
          </Card>
        ) : (
          <Card>
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
            <div className="mt-5">
              <Pagination
                page={page}
                totalPages={totalPages}
                hrefFor={(p) => `/campaigns/${id}/drafts?page=${p}`}
              />
            </div>
          </Card>
        )}
      </PageBody>
    </>
  );
}
