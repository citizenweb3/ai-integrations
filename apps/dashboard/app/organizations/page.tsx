import { listCampaignsWithOrgRollup } from "@bizdev/db";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import { Badge } from "@/components/ui";

// T-026AO/C: /organizations is now a hub. Each card is a campaign with
// the rolled-up org and pending-triage counts; the operator drills
// into /campaigns/[id]/organizations to see the actual org list. This
// stops the cross-campaign mix that confused operators when more than
// one campaign was active.

export const dynamic = "force-dynamic";

export default async function OrganizationsHubPage() {
  const rows = await listCampaignsWithOrgRollup();
  const populated = rows.filter((row) => row.orgCount > 0);

  return (
    <>
      <ConsoleHero
        currentNav="organizations"
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            / Organizations
          </>
        }
        title="Organisations"
        subtitle="Organisations are grouped by their source campaign. Pick a campaign card to see the orgs it produced — research snapshots, contacts, and threads live inside each one."
      />

      <section className="max-w-[88vw] mx-auto px-4 pb-24 space-y-6">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="text-xs font-semibold tracking-[0.2em] uppercase opacity-60 mb-2">
            How this page works
          </div>
          <p className="text-sm font-light opacity-90 max-w-3xl">
            This page lists every campaign that has at least one accepted candidate. Each card shows
            the number of organisations attached to that campaign and how many of them still have
            pending contact-triage work. Click into a campaign to open its organisations list — the
            individual org pages (research snapshot, contacts, threads, drafts) sit one level below
            that.
          </p>
        </div>

        {populated.length === 0 ? (
          <Card>
            <p className="font-light opacity-80">
              No campaigns have produced organisations yet. Create a campaign on{" "}
              <Link href="/campaigns" className="text-[hsl(var(--primary))]">
                /campaigns
              </Link>{" "}
              and accept a discovery candidate — the campaign will show up here as soon as
              research_snapshot runs.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {populated.map((row) => (
              <Link
                key={row.id}
                href={`/campaigns/${row.id}/organizations`}
                className="block hover:no-underline"
              >
                <Card className="h-full hover:bg-white/10 transition-colors">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="min-w-0">
                      <h3 className="text-xl font-bold tracking-[0.02em] truncate">
                        {row.name}
                      </h3>
                      <div className="text-xs uppercase tracking-[0.18em] opacity-60 mt-1">
                        Campaign
                      </div>
                    </div>
                    <Badge tone={row.status === "active" ? "accent" : "default"}>
                      {row.status}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-5 mt-6">
                    <Stat
                      label="Organisations"
                      hint="Distinct organisations accepted from this campaign's discovery list."
                      value={row.orgCount}
                    />
                    <Stat
                      label="Pending contacts"
                      hint="People the agent surfaced across this campaign's orgs that still need your Approve or Reject."
                      value={row.pendingContactCandidateCount}
                      highlight={row.pendingContactCandidateCount > 0}
                    />
                  </div>

                  <div className="mt-5 text-xs font-semibold tracking-[0.18em] uppercase text-[var(--accent)]">
                    View organisations →
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Stat({
  label,
  hint,
  value,
  highlight = false
}: {
  label: string;
  hint?: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className={`text-2xl font-bold ${highlight ? "text-[var(--accent)]" : ""}`}>{value}</div>
      <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-1">{label}</div>
      {hint ? (
        <div className="text-[11px] font-light opacity-50 leading-snug mt-1">{hint}</div>
      ) : null}
    </div>
  );
}
