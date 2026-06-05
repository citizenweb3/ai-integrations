import {
  getCampaignDiscoveryView,
  getSendableDraftsForCampaign,
  listOrganizationsForDashboard
} from "@bizdev/db";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import { Badge, PageBody } from "@/components/ui";
import { OrgListingCard } from "@/components/org-listing-card";
import { SendAllDraftsDrawer } from "@/components/send-all-drafts-drawer";
import { Pagination } from "@/components/pagination";
import { AutoRefreshWhenActive } from "@/components/auto-refresh-when-active";
import {
  BackgroundActivityStrip,
  liveActivityTotal,
} from "@/components/background-activity-strip";

// T-026AO/B: per-campaign organisations subpage. The flat /organizations
// listing became a hub of campaign cards; the actual organisation
// cards live here, scoped to one campaign at a time.

export const dynamic = "force-dynamic";

// T-026BS: filter the per-campaign org list.
//   contacts   — org has a person attached (approved contact or pending candidate)
//   emails     — org has at least one addressable email
//   drafts     — org has at least one non-discarded draft
//   needreview — org has NO draft: contact missing, email missing, research
//                stalled, etc. — i.e. drafting did not work out for some reason
// Default "all".
type OrgFilter = "all" | "contacts" | "emails" | "drafts" | "needreview";

const ORG_FILTERS: readonly OrgFilter[] = [
  "all",
  "contacts",
  "emails",
  "drafts",
  "needreview"
];

function parseFilter(raw: string | string[] | undefined): OrgFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (ORG_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as OrgFilter)
    : "all";
}

type OrgRow = Awaited<ReturnType<typeof listOrganizationsForDashboard>>[number];

const ORG_PREDICATES: Record<OrgFilter, (o: OrgRow) => boolean> = {
  all: () => true,
  contacts: (o) => o.contactCount > 0 || o.pendingContactCandidateCount > 0,
  emails: (o) => o.addressableEmailCount > 0,
  drafts: (o) => o.draftCount > 0,
  needreview: (o) => o.draftCount === 0
};

const ORGS_PAGE_SIZE = 9;

const ORG_FILTER_LABELS: Record<OrgFilter, string> = {
  all: "All organisations",
  contacts: "With contacts",
  emails: "With emails",
  drafts: "With drafts",
  needreview: "Need review"
};

function filterLabel(filter: OrgFilter): string {
  return ORG_FILTER_LABELS[filter].toLowerCase();
}

export default async function CampaignOrganizationsPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const filter = parseFilter(query["filter"]);
  const view = await getCampaignDiscoveryView(id);
  if (!view) {
    notFound();
  }
  // T-026BU: archived campaign is stopped + read-only — bounce subpages back to
  // the detail page (archived banner + Restore) instead of showing live actions.
  if (view.campaign.archivedAt) {
    redirect(`/campaigns/${id}`);
  }
  const allOrgs = await listOrganizationsForDashboard({ campaignId: id });
  const counts = {
    all: allOrgs.length,
    contacts: allOrgs.filter(ORG_PREDICATES.contacts).length,
    emails: allOrgs.filter(ORG_PREDICATES.emails).length,
    drafts: allOrgs.filter(ORG_PREDICATES.drafts).length,
    needreview: allOrgs.filter(ORG_PREDICATES.needreview).length
  };
  const filteredOrgs = allOrgs.filter(ORG_PREDICATES[filter]);

  // Pagination over the filtered set (allOrgs is already loaded, so the
  // slice is in-memory). hrefFor keeps the active filter in the URL.
  const totalPages = Math.max(1, Math.ceil(filteredOrgs.length / ORGS_PAGE_SIZE));
  const rawPage = Array.isArray(query["page"]) ? query["page"][0] : query["page"];
  const parsedPage = Number.parseInt(rawPage ?? "1", 10);
  const page = Number.isNaN(parsedPage)
    ? 1
    : Math.min(Math.max(1, parsedPage), totalPages);
  const orgs = filteredOrgs.slice((page - 1) * ORGS_PAGE_SIZE, page * ORGS_PAGE_SIZE);
  const orgHref = (f: OrgFilter, p: number) => {
    const params = new URLSearchParams();
    if (f !== "all") params.set("filter", f);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/campaigns/${id}/organizations${qs ? `?${qs}` : ""}`;
  };

  const sendableDrafts = await getSendableDraftsForCampaign(id);

  return (
    <>
      <ConsoleHero
        currentNav="organizations"
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            /{" "}
            <Link href="/organizations" className="text-[hsl(var(--primary))]">
              Organizations
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
        title={`Organisations · ${view.campaign.name}`}
        subtitle={`${counts.all} organisation${counts.all === 1 ? "" : "s"} accepted from this campaign. Filter, then open one to review research, approve contacts, and generate drafts.`}
      />

      <PageBody>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href={`/campaigns/${view.campaign.id}`}
            className="opacity-70 hover:opacity-100 underline decoration-dotted"
          >
            ← Back to campaign
          </Link>
          <span className="opacity-40">·</span>
          <span className="opacity-70">
            Campaign status: <Badge tone="default">{view.campaign.status}</Badge>
          </span>
        </div>

        <BackgroundActivityStrip activity={view.liveActivity} />
        <AutoRefreshWhenActive active={liveActivityTotal(view.liveActivity) > 0} />

        {allOrgs.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <OrgFilterTabs
              active={filter}
              counts={counts}
              hrefFor={(f) => orgHref(f, 1)}
            />
            <SendAllDraftsDrawer drafts={sendableDrafts} />
          </div>
        ) : null}

        {filteredOrgs.length === 0 && allOrgs.length > 0 ? (
          <Card>
            {filter === "needreview" ? (
              <p className="text-sm font-light opacity-80">
                Nothing to review — every organisation in this campaign already
                has a draft. Switch to{" "}
                <Link href={orgHref("all", 1)} className="text-[hsl(var(--primary))]">
                  All
                </Link>{" "}
                to see them.
              </p>
            ) : (
              <p className="text-sm font-light opacity-80">
                No organisations match this filter. Switch back to{" "}
                <Link href={orgHref("all", 1)} className="text-[hsl(var(--primary))]">
                  All
                </Link>{" "}
                to see every accepted organisation.
              </p>
            )}
          </Card>
        ) : allOrgs.length === 0 ? (
          <Card>
            {liveActivityTotal(view.liveActivity) > 0 ? (
              <p className="text-sm font-light opacity-80">
                Discovery is running for this campaign right now — organisations
                will appear here as soon as the agent accepts the first
                candidate. The page auto-refreshes every 5 seconds while
                background work is in flight; you do not need to reload.
              </p>
            ) : (
              <p className="text-sm font-light opacity-80">
                No organisations accepted from this campaign yet. Accept a candidate from the{" "}
                <Link
                  href={`/campaigns/${view.campaign.id}/candidates`}
                  className="text-[hsl(var(--primary))]"
                >
                  candidate triage page
                </Link>{" "}
                and the org will land here once research_snapshot runs.
              </p>
            )}
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Orgs come back addressability-first from the query, so the
                flat grid already surfaces sendable orgs at the top; the
                per-card "Addressable" pill carries what the old section
                headers used to say, and the filter tabs do the slicing. */}
            <p className="text-xs font-light opacity-60">
              Showing {orgs.length} of {filteredOrgs.length}
              {filter === "needreview"
                ? " organisation(s) with no draft yet — contact, email, or research is missing."
                : ` ${filterLabel(filter)} organisation(s).`}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {orgs.map((org) => (
                <OrgListingCard key={org.id} org={org} />
              ))}
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              hrefFor={(p) => orgHref(filter, p)}
            />
          </div>
        )}
      </PageBody>
    </>
  );
}

// T-026BS: filter tabs for the per-campaign org list. Plain links that
// set ?filter= so the server re-renders the filtered set — no client
// state needed, and the choice survives the auto-refresh that runs while
// background work is in flight.
function OrgFilterTabs({
  active,
  counts,
  hrefFor
}: {
  active: OrgFilter;
  counts: Record<OrgFilter, number>;
  hrefFor: (filter: OrgFilter) => string;
}) {
  const tabs = ORG_FILTERS.map((key) => ({
    key,
    label: ORG_FILTER_LABELS[key],
    count: counts[key],
    href: hrefFor(key)
  }));
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={
              isActive
                ? "inline-flex items-center gap-2 rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-1.5 text-sm font-semibold text-[var(--accent)] hover:no-underline"
                : "inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-1.5 text-sm font-light opacity-75 hover:opacity-100 hover:bg-white/5 hover:no-underline transition-colors"
            }
          >
            {tab.label}
            <span
              className={
                isActive
                  ? "text-xs font-bold"
                  : "text-xs font-bold opacity-60"
              }
            >
              {tab.count}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
