import { listCampaignsForDashboard } from "@bizdev/db";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import { Badge, PageBody, PillLink } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CampaignsIndexPage() {
  const items = await listCampaignsForDashboard();

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
        actions={<PillLink href="/campaigns/new" primary>New campaign</PillLink>}
      />

      <PageBody>
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
                <Card className="h-full hover:from-[#7C7C81]/35 transition-colors">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="min-w-0">
                      <h3 className="text-xl font-bold tracking-[0.02em] truncate">{c.name}</h3>
                      <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-1">
                        {c.status}
                      </div>
                    </div>
                    {c.pendingCandidates > 0 ? (
                      <Badge tone="warning">{c.pendingCandidates} pending</Badge>
                    ) : (
                      <Badge>{c.totalCandidates} candidates</Badge>
                    )}
                  </div>

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
