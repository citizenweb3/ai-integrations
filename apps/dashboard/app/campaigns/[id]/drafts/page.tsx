import {
  countDraftsForCampaign,
  getCampaignDiscoveryView,
  getDraftsForCampaign,
  getSendableDraftsForCampaign,
  type DraftSendMode
} from "@bizdev/db";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import { Badge, PageBody } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { SendAllDraftsDrawer } from "@/components/send-all-drafts-drawer";

// Dedicated, paginated drafts page for a single campaign. Reached by drilling
// into a campaign card on /drafts. Two tabs split the drafts by send state:
// "To send" (draft / queued / send-failed) and "Sent" (dispatched). Plus the
// bulk "Send all" action.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

// T-026BT: tab = send state. "to_send" is the default working set.
function parseTab(raw: string | string[] | undefined): "to_send" | "sent" {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "sent" ? "sent" : "to_send";
}

// A draft is "Sent" once its outbound was dispatched (status flips to
// 'approved'); 'sent' is the legacy equivalent. Everything else is in the
// to-send pipeline. The badge makes the state legible (raw 'approved' reads
// as "Sent").
function statusBadge(status: string): { label: string; tone: "accent" | "primary" | "danger" | "default" } {
  if (status === "approved" || status === "sent") return { label: "Sent", tone: "accent" };
  if (status === "approved_pending_send") return { label: "queued", tone: "primary" };
  if (status === "send_failed_post_approve") return { label: "send failed", tone: "danger" };
  return { label: status, tone: "default" };
}

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
  // T-026BU: an archived campaign is stopped + read-only — its subpages still
  // exposed live send actions, so bounce back to the detail page (archived
  // banner + Restore).
  if (view.campaign.archivedAt) {
    redirect(`/campaigns/${id}`);
  }

  const tab = parseTab(query["tab"]);
  const mode: DraftSendMode = tab;
  const [toSendCount, sentCount] = await Promise.all([
    countDraftsForCampaign(id, { mode: "to_send" }),
    countDraftsForCampaign(id, { mode: "sent" })
  ]);
  const total = tab === "sent" ? sentCount : toSendCount;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rawPage = Array.isArray(query["page"]) ? query["page"][0] : query["page"];
  const parsedPage = Number.parseInt(rawPage ?? "1", 10);
  const page = Number.isNaN(parsedPage)
    ? 1
    : Math.min(Math.max(1, parsedPage), totalPages);

  const drafts = await getDraftsForCampaign(id, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    mode
  });
  const sendableDrafts = await getSendableDraftsForCampaign(id);

  const tabHref = (t: "to_send" | "sent") => `/campaigns/${id}/drafts?tab=${t}`;

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
        subtitle={`${toSendCount} to send · ${sentCount} sent. Review each before sending; use "Send all drafts" to approve the ready ones in one pass.`}
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

        {/* T-026BT: To-send / Sent tabs. */}
        <div className="flex flex-wrap gap-2">
          {([
            { key: "to_send" as const, label: "To send", count: toSendCount },
            { key: "sent" as const, label: "Sent", count: sentCount }
          ]).map((t) => {
            const active = t.key === tab;
            return (
              <Link
                key={t.key}
                href={tabHref(t.key)}
                className={
                  active
                    ? "inline-flex items-center gap-2 rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-1.5 text-sm font-semibold text-[var(--accent)] hover:no-underline"
                    : "inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-1.5 text-sm font-light opacity-75 hover:opacity-100 hover:bg-white/5 hover:no-underline transition-colors"
                }
              >
                {t.label}
                <span className={active ? "text-xs font-bold" : "text-xs font-bold opacity-60"}>
                  {t.count}
                </span>
              </Link>
            );
          })}
        </div>

        {total === 0 ? (
          <Card>
            <p className="text-sm font-light opacity-70">
              {tab === "sent"
                ? "No drafts have been sent for this campaign yet."
                : "Nothing waiting to send. New drafts generate automatically once an organisation has a published research snapshot and an addressable contact."}
            </p>
          </Card>
        ) : (
          <Card>
            <ul className="space-y-3">
              {drafts.map((d) => {
                const badge = statusBadge(d.status);
                return (
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
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </div>
                    </div>
                    <div className="text-xs opacity-60">
                      {d.contactEmail ?? "no contact"}
                      {d.threadId ? ` · thread ${d.threadId}` : ""}
                      {" · updated "}
                      {d.updatedAt.toISOString()}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-5">
              <Pagination
                page={page}
                totalPages={totalPages}
                hrefFor={(p) => `/campaigns/${id}/drafts?tab=${tab}&page=${p}`}
              />
            </div>
          </Card>
        )}
      </PageBody>
    </>
  );
}
