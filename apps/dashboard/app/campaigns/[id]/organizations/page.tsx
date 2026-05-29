import { getCampaignDiscoveryView, listOrganizationsForDashboard } from "@bizdev/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import { Badge, PageBody } from "@/components/ui";
import { OrgListingCard } from "@/components/org-listing-card";

// T-026AO/B: per-campaign organisations subpage. The flat /organizations
// listing became a hub of campaign cards; the actual organisation
// cards live here, scoped to one campaign at a time.

export const dynamic = "force-dynamic";

export default async function CampaignOrganizationsPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const view = await getCampaignDiscoveryView(id);
  if (!view) {
    notFound();
  }
  const orgs = await listOrganizationsForDashboard({ campaignId: id });

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

        {orgs.length === 0 ? (
          <Card>
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
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {orgs.map((org) => (
              <OrgListingCard key={org.id} org={org} />
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
