import { getCampaignDiscoveryView } from "@bizdev/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import ConsoleHero from "@/components/console-hero";
import { DiscoveryCandidatePanels } from "@/components/discovery-candidate-panels";
import { DismissableBanner } from "@/components/dismissable-banner";
import { Badge, PageBody } from "@/components/ui";

// T-026AG/B: dedicated candidate triage page. Lifted out of
// /campaigns/[id]/page.tsx so the campaign summary stays a one-screen
// control panel and the operator dives into the (potentially long)
// candidate list with intent.

export const dynamic = "force-dynamic";

export default async function CampaignCandidatesPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const errorRaw = query["error"];
  const errorMessage = typeof errorRaw === "string" ? errorRaw : Array.isArray(errorRaw) ? errorRaw[0] : null;
  const noticeRaw = query["notice"];
  const noticeMessage = typeof noticeRaw === "string" ? noticeRaw : Array.isArray(noticeRaw) ? noticeRaw[0] : null;

  const view = await getCampaignDiscoveryView(id);
  if (!view) {
    notFound();
  }

  const totals = Object.values(view.candidatesByStatus).reduce((sum, list) => sum + list.length, 0);
  const pendingTriage =
    view.candidatesByStatus.proposed.length + view.candidatesByStatus.needs_review.length;

  return (
    <>
      <ConsoleHero
        currentNav="campaigns"
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            /{" "}
            <Link href="/campaigns" className="text-[hsl(var(--primary))]">
              Campaigns
            </Link>{" "}
            /{" "}
            <Link
              href={`/campaigns/${view.campaign.id}`}
              className="text-[hsl(var(--primary))]"
            >
              {view.campaign.name}
            </Link>{" "}
            / Candidates
          </>
        }
        title={`Candidates · ${view.campaign.name}`}
        subtitle={`${totals} candidate${totals === 1 ? "" : "s"} across all states · ${pendingTriage} waiting on operator triage`}
      />

      <PageBody>
        {errorMessage ? (
          <DismissableBanner
            tone="error"
            queryKey="error"
            eyebrow="Last action failed"
            message={errorMessage}
            hint="Code + message returned by the command handler. Adjust scope or capacity and retry."
          />
        ) : null}

        {noticeMessage ? (
          <DismissableBanner
            tone="notice"
            queryKey="notice"
            eyebrow="Action confirmed"
            message={noticeMessage}
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href={`/campaigns/${view.campaign.id}`}
            className="opacity-70 hover:opacity-100 underline decoration-dotted"
          >
            ← Back to campaign
          </Link>
          <span className="opacity-40">·</span>
          <span className="opacity-70">
            Pending triage: <Badge tone={pendingTriage > 0 ? "warning" : "default"}>{pendingTriage}</Badge>
          </span>
          <span className="opacity-40">·</span>
          <span className="opacity-70">
            Cap: {view.candidatesByStatus.proposed.length +
              view.candidatesByStatus.accepted.length +
              view.candidatesByStatus.needs_review.length +
              view.candidatesByStatus.queued_for_enrichment.length +
              view.candidatesByStatus.enriched.length}/{view.campaign.maxOrganizationsToDiscover}
          </span>
        </div>

        {totals === 0 ? (
          <p className="text-sm font-light opacity-70">
            Discovery has not produced any candidates yet. Once the first run completes (or finishes a re-run),
            they will land here.
          </p>
        ) : (
          <DiscoveryCandidatePanels candidatesByStatus={view.candidatesByStatus} />
        )}
      </PageBody>
    </>
  );
}
