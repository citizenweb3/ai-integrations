import { listCampaignsForDashboard, listArchivedCampaignsForDashboard } from "@bizdev/db";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import { Badge, Button, PageBody, PillLink } from "@/components/ui";
import { AutoRefreshWhenActive } from "@/components/auto-refresh-when-active";
import { liveActivityTotal } from "@/components/background-activity-strip";

export const dynamic = "force-dynamic";

export default async function CampaignsIndexPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const archivedRaw = query["archived"];
  const showArchived = (Array.isArray(archivedRaw) ? archivedRaw[0] : archivedRaw) === "1";

  // T-026BU: archived (soft-deleted) campaigns view. Hidden from the default
  // list; surfaced here so archive stays self-service reversible via Restore.
  if (showArchived) {
    return <ArchivedCampaignsView />;
  }

  const items = await listCampaignsForDashboard();
  const anyActive = items.some((c) => liveActivityTotal(c.liveActivity) > 0);

  return (
    <>
      <ConsoleHero currentNav="campaigns"
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            / Campaigns
          </>
        }
        title="Campaigns"
        subtitle={`${items.length} campaign${items.length === 1 ? "" : "s"}. Open one to run prospect discovery and triage proposed organisations.`}
        actions={
          <div className="flex items-center gap-3">
            <PillLink href="/campaigns?archived=1">Show archived</PillLink>
            <PillLink href="/campaigns/new" primary>New campaign</PillLink>
          </div>
        }
      />

      <PageBody>
        <AutoRefreshWhenActive active={anyActive} />
        {items.length === 0 ? (
          <Card>
            <p className="font-light opacity-80">
              No campaigns yet. Create one via the start_campaign command.
              {" "}
              <Link href="/campaigns/new" className="text-[hsl(var(--primary))]">
                Open the scope form
              </Link>
              .
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {items.map((c) => (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="block hover:no-underline">
                <Card className="h-full hover:bg-white/10 transition-colors">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="min-w-0">
                      <h3 className="text-xl font-bold tracking-[0.02em] truncate">{c.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs uppercase tracking-[0.2em] opacity-60">
                          {c.status}
                        </span>
                        <CampaignStageBadge campaign={c} />
                      </div>
                    </div>
                    {c.pendingCandidates > 0 ? (
                      <Badge tone="warning">{c.pendingCandidates} pending</Badge>
                    ) : (
                      <Badge>{c.totalCandidates} candidates</Badge>
                    )}
                  </div>

                  <ActivityRow activity={c.liveActivity} />

                  <p className="text-sm font-light opacity-80 line-clamp-3 mb-4">
                    {c.objective}
                  </p>

                  <div className="grid grid-cols-4 gap-3 text-center">
                    <CountTile label="Proposed" value={c.candidateCounts.proposed} />
                    <CountTile
                      label="Needs review"
                      value={c.candidateCounts.needs_review}
                      accent={c.candidateCounts.needs_review > 0}
                    />
                    <CountTile
                      label="Enriching"
                      value={c.candidateCounts.queued_for_enrichment + c.candidateCounts.enriched}
                    />
                    <CountTile
                      label="Closed"
                      value={
                        c.candidateCounts.duplicate +
                        c.candidateCounts.rejected_by_policy +
                        c.candidateCounts.insufficient_fit
                      }
                    />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center border-t border-white/10 pt-4 mt-4">
                    <CountTile label="Contacts" value={c.progress.contactsAccepted} />
                    <CountTile label="Drafts" value={c.progress.draftsGenerated} />
                    <CountTile label="Approved" value={c.progress.draftsApproved} />
                    <CountTile label="Sent" value={c.progress.sent} />
                    <CountTile label="Replies" value={c.progress.replied} accent={c.progress.replied > 0} />
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

// T-026BU: archived (soft-deleted) campaigns listing. Lightweight rows — name,
// objective, the status Restore will return them to, and when they were
// archived — each with a Restore action (unarchive_campaign). The name links to
// the campaign's own page, which still loads while archived.
async function ArchivedCampaignsView() {
  const items = await listArchivedCampaignsForDashboard();
  return (
    <>
      <ConsoleHero currentNav="campaigns"
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            /{" "}
            <Link href="/campaigns" className="text-[hsl(var(--primary))]">
              Campaigns
            </Link>{" "}
            / Archived
          </>
        }
        title="Archived campaigns"
        subtitle={`${items.length} archived campaign${items.length === 1 ? "" : "s"}. Restore brings one back with its previous status; its data was never deleted.`}
        actions={<PillLink href="/campaigns" primary>Show active</PillLink>}
      />

      <PageBody>
        {items.length === 0 ? (
          <Card>
            <p className="font-light opacity-80">
              No archived campaigns.{" "}
              <Link href="/campaigns" className="text-[hsl(var(--primary))]">
                Back to active campaigns
              </Link>
              .
            </p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {items.map((c) => (
              <li key={c.id}>
                <Card>
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/campaigns/${c.id}`}
                          className="text-lg font-bold tracking-[0.02em] truncate hover:text-[var(--accent)] hover:no-underline"
                        >
                          {c.name}
                        </Link>
                        <Badge tone="danger">archived</Badge>
                      </div>
                      <p className="text-sm font-light opacity-70 line-clamp-2 mt-1 max-w-2xl">
                        {c.objective}
                      </p>
                      <div className="text-xs opacity-60 mt-2">
                        restores to{" "}
                        <span className="font-semibold">{c.preArchiveStatus ?? "paused"}</span>
                        {" · archived "}
                        {c.archivedAt.toISOString()}
                      </div>
                    </div>
                    <form action="/api/commands" method="post" className="shrink-0">
                      <input type="hidden" name="commandType" value="unarchive_campaign" />
                      <input type="hidden" name="campaignId" value={c.id} />
                      <Button type="submit">Restore</Button>
                    </form>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}

function CountTile({
  label,
  value,
  accent = false
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div>
      <div className={`text-2xl font-bold ${accent ? "text-[var(--accent)]" : ""}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-[0.18em] opacity-60 mt-1">{label}</div>
    </div>
  );
}

// Single-glance stage tag that derives the most-relevant pipeline label
// from the candidate counts + live activity. Reads from the listing item
// only — no extra queries — so the cards stay cheap to render.
type StageDescriptor = {
  label: string;
  tone: "accent" | "default";
  title?: string;
};

function deriveCampaignCardStage(c: {
  status: string;
  totalCandidates: number;
  pendingCandidates: number;
  candidateCounts: Record<string, number>;
  liveActivity: {
    discoveryRunning: number;
    researchInFlight: number;
    contactDiscoveryInFlight: number;
    draftingInFlight: number;
  };
  progress: { sent: number; replied: number; draftsApproved: number };
}): StageDescriptor {
  const a = c.liveActivity;
  if (a.discoveryRunning > 0) {
    return { label: "Discovery running", tone: "accent" };
  }
  if (a.researchInFlight > 0) {
    return {
      label: `Research ${a.researchInFlight} in flight`,
      tone: "accent",
    };
  }
  if (a.contactDiscoveryInFlight > 0) {
    return {
      label: `Finding contacts (${a.contactDiscoveryInFlight})`,
      tone: "accent",
    };
  }
  if (a.draftingInFlight > 0) {
    return {
      label: `Drafting (${a.draftingInFlight})`,
      tone: "accent",
    };
  }
  if (c.pendingCandidates > 0) {
    return {
      label: `${c.pendingCandidates} need review`,
      tone: "accent",
      title: "Discovery returned candidates that need your Accept / Reject before research starts.",
    };
  }
  if (c.totalCandidates === 0 && c.status === "active") {
    return {
      label: "Awaiting first discovery",
      tone: "default",
    };
  }
  if (c.progress.sent > 0 || c.progress.replied > 0) {
    return {
      label: "Outreach in flight",
      tone: "default",
      title: "Discovery, research and contact discovery are settled; drafts are sending or already sent.",
    };
  }
  if (c.progress.draftsApproved > 0) {
    return {
      label: "Drafts approved",
      tone: "default",
    };
  }
  return { label: "Idle", tone: "default", title: "No pipeline work in flight." };
}

function CampaignStageBadge({
  campaign
}: {
  campaign: Parameters<typeof deriveCampaignCardStage>[0];
}) {
  const stage = deriveCampaignCardStage(campaign);
  const cls =
    stage.tone === "accent"
      ? "border border-[var(--accent)]/50 text-[var(--accent)] bg-[var(--accent)]/10"
      : "border border-white/15 text-white/70";
  return (
    <span
      className={`text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-full ${cls}`}
      title={stage.title}
    >
      {stage.label}
    </span>
  );
}

function ActivityRow({
  activity
}: {
  activity: {
    discoveryRunning: number;
    researchInFlight: number;
    contactDiscoveryInFlight: number;
    draftingInFlight: number;
  };
}) {
  const items: Array<{ label: string; count: number }> = [
    { label: "Discovery", count: activity.discoveryRunning },
    { label: "Research", count: activity.researchInFlight },
    { label: "Contacts", count: activity.contactDiscoveryInFlight },
    { label: "Drafting", count: activity.draftingInFlight },
  ];
  const active = items.filter((item) => item.count > 0);
  if (active.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] mb-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-1.5">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75 animate-ping" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent)]" />
      </span>
      {active.map((item) => (
        <span key={item.label} className="opacity-90">
          <span className="font-semibold">{item.count}</span>{" "}
          <span className="opacity-70">{item.label}</span>
        </span>
      ))}
    </div>
  );
}
