import { getCampaignDiscoveryView, listOrganizationsForDashboard } from "@bizdev/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import { Badge, PageBody } from "@/components/ui";
import { OrgListingCard } from "@/components/org-listing-card";
import { AutoRefreshWhenActive } from "@/components/auto-refresh-when-active";
import {
  BackgroundActivityStrip,
  liveActivityTotal,
} from "@/components/background-activity-strip";

// T-026AO/B: per-campaign organisations subpage. The flat /organizations
// listing became a hub of campaign cards; the actual organisation
// cards live here, scoped to one campaign at a time.

export const dynamic = "force-dynamic";

// T-026BS: filter the per-campaign org list. "contacts" = org has at
// least one person attached (approved contact or pending candidate);
// "drafts" = org has at least one non-discarded draft. Default "all".
type OrgFilter = "all" | "contacts" | "drafts";

function parseFilter(raw: string | string[] | undefined): OrgFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "contacts" || value === "drafts" ? value : "all";
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
  const allOrgs = await listOrganizationsForDashboard({ campaignId: id });
  const hasContacts = (o: (typeof allOrgs)[number]) =>
    o.contactCount > 0 || o.pendingContactCandidateCount > 0;
  const counts = {
    all: allOrgs.length,
    contacts: allOrgs.filter(hasContacts).length,
    drafts: allOrgs.filter((o) => o.draftCount > 0).length
  };
  const orgs =
    filter === "contacts"
      ? allOrgs.filter(hasContacts)
      : filter === "drafts"
        ? allOrgs.filter((o) => o.draftCount > 0)
        : allOrgs;

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
        subtitle={`${orgs.length} organisation${orgs.length === 1 ? "" : "s"} accepted from this campaign. Open one to review research, approve contacts, and generate drafts.`}
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
          <OrgFilterTabs
            campaignId={view.campaign.id}
            active={filter}
            counts={counts}
          />
        ) : null}

        {allOrgs.length > 0 && orgs.length === 0 ? (
          <Card>
            <p className="text-sm font-light opacity-80">
              No organisations match this filter. Switch back to{" "}
              <Link
                href={`/campaigns/${view.campaign.id}/organizations`}
                className="text-[hsl(var(--primary))]"
              >
                All
              </Link>{" "}
              to see every accepted organisation.
            </p>
          </Card>
        ) : orgs.length === 0 ? (
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
        ) : (() => {
          // T-026AR: orgs are sorted by addressability — those with at
          // least one approved-with-email or pending-with-email contact
          // sit at the top, the rest below. Splitting into two labelled
          // groups + an explainer makes the contract visible so
          // operators do not have to infer it from card order alone.
          const addressable = orgs.filter((o) => o.addressableEmailCount > 0);
          const inert = orgs.filter((o) => o.addressableEmailCount === 0);
          return (
            <div className="space-y-10">
              <section>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-semibold tracking-[0.18em] uppercase text-[var(--accent)]">
                    Addressable ({addressable.length})
                  </span>
                  <span className="flex-1 h-px bg-[var(--accent)]/20" />
                </div>
                <p className="text-xs font-light opacity-65 leading-snug max-w-3xl mb-4">
                  These organisations have at least one contact with an email
                  address — approved by you, auto-approved from a verbatim agent
                  find, or still pending with the email already on file. Ordered
                  by how many sendable addresses are attached, most first. Pick
                  one to generate a draft against.
                </p>
                {addressable.length === 0 ? (
                  <p className="text-sm font-light opacity-60 italic">
                    None yet. Either approve a pending candidate with an email
                    on one of the orgs below, or add an email to an approved
                    contact, and the org will move up to this group.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {addressable.map((org) => (
                      <OrgListingCard key={org.id} org={org} />
                    ))}
                  </div>
                )}
              </section>

              {inert.length > 0 ? (
                <section>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-semibold tracking-[0.18em] uppercase text-yellow-400">
                      Waiting on an email ({inert.length})
                    </span>
                    <span className="flex-1 h-px bg-yellow-500/20" />
                  </div>
                  <p className="text-xs font-light opacity-65 leading-snug max-w-3xl mb-4">
                    These organisations were accepted by discovery and may
                    have approved contacts attached, but none of them carry an
                    email yet. Drafts cannot target them. Open one to look at
                    the Pending or Approved-but-no-email contacts and add an
                    address — the org will then jump to the group above.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {inert.map((org) => (
                      <OrgListingCard key={org.id} org={org} />
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          );
        })()}
      </PageBody>
    </>
  );
}

// T-026BS: filter tabs for the per-campaign org list. Plain links that
// set ?filter= so the server re-renders the filtered set — no client
// state needed, and the choice survives the auto-refresh that runs while
// background work is in flight.
function OrgFilterTabs({
  campaignId,
  active,
  counts
}: {
  campaignId: string;
  active: OrgFilter;
  counts: { all: number; contacts: number; drafts: number };
}) {
  const base = `/campaigns/${campaignId}/organizations`;
  const tabs: Array<{ key: OrgFilter; label: string; count: number; href: string }> = [
    { key: "all", label: "All organisations", count: counts.all, href: base },
    { key: "contacts", label: "With contacts", count: counts.contacts, href: `${base}?filter=contacts` },
    { key: "drafts", label: "With drafts", count: counts.drafts, href: `${base}?filter=drafts` }
  ];
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
