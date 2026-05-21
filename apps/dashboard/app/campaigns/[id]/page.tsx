import { getCampaignDiscoveryView, type DiscoveryCandidateView } from "@bizdev/db";
import {
  buildAcceptDiscoveryCandidateIdempotencyKey,
  buildRejectDiscoveryCandidateIdempotencyKey,
  discoveryRejectionReasonCodes,
  type DiscoveryRejectionReasonCode,
  type DiscoveryCandidateStatus
} from "@bizdev/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import {
  Badge,
  Button,
  InfoRow,
  MetricCard,
  PageBody,
  inputClass,
  textareaClass
} from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS_DISPLAY: Record<
  DiscoveryCandidateStatus,
  { label: string; tone: "default" | "accent" | "primary" | "warning" | "danger" }
> = {
  proposed: { label: "Proposed", tone: "primary" },
  needs_review: { label: "Needs review", tone: "warning" },
  queued_for_enrichment: { label: "Queued for enrichment", tone: "accent" },
  enriched: { label: "Enriched", tone: "accent" },
  duplicate: { label: "Duplicate", tone: "default" },
  accepted: { label: "Accepted", tone: "accent" },
  insufficient_fit: { label: "Insufficient fit", tone: "default" },
  rejected_by_policy: { label: "Rejected", tone: "danger" }
};

const PANEL_ORDER: DiscoveryCandidateStatus[] = [
  "needs_review",
  "proposed",
  "queued_for_enrichment",
  "enriched",
  "duplicate",
  "insufficient_fit",
  "rejected_by_policy",
  "accepted"
];

const REJECTION_REASON_LABELS: Record<DiscoveryRejectionReasonCode, string> = {
  out_of_segment: "Out of segment",
  dead_company: "Dead company",
  competitor: "Competitor",
  existing_customer: "Existing customer",
  wrong_geo: "Wrong geo",
  private_pii: "Private PII",
  other: "Other"
};

export default async function CampaignDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const view = await getCampaignDiscoveryView(id);
  if (!view) {
    notFound();
  }

  const totals = Object.values(view.candidatesByStatus).reduce(
    (sum, list) => sum + list.length,
    0
  );
  const pending =
    view.candidatesByStatus.proposed.length + view.candidatesByStatus.needs_review.length;
  const replyClassBreakdown = Object.entries(view.progress.replyClassCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([replyClass, count]) => `${formatReplyClass(replyClass)}: ${count}`)
    .join(", ");

  return (
    <>
      <ConsoleHero
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            /{" "}
            <Link href="/campaigns" className="text-[hsl(var(--primary))]">
              Campaigns
            </Link>{" "}
            / {view.campaign.name}
          </>
        }
        title={view.campaign.name}
        subtitle={view.campaign.objective}
      />

      <PageBody>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Total candidates" value={totals} />
          <MetricCard label="Pending review" value={pending} accent={pending > 0} />
          <MetricCard
            label="Enriching / enriched"
            value={
              view.candidatesByStatus.queued_for_enrichment.length +
              view.candidatesByStatus.enriched.length
            }
          />
          <MetricCard
            label="Closed"
            value={
              view.candidatesByStatus.duplicate.length +
              view.candidatesByStatus.insufficient_fit.length +
              view.candidatesByStatus.rejected_by_policy.length
            }
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <MetricCard label="Contacts accepted" value={view.progress.contactsAccepted} />
          <MetricCard label="Drafts generated" value={view.progress.draftsGenerated} />
          <MetricCard label="Drafts approved" value={view.progress.draftsApproved} />
          <MetricCard label="Sent" value={view.progress.sent} />
          <MetricCard label="Replies" value={view.progress.replied} accent={view.progress.replied > 0} />
        </div>

        <Card>
          <BlockTitle title="Progress" className="mb-4 text-left" />
          <InfoRow
            label="Reply classes"
            value={replyClassBreakdown || <span className="opacity-50">none</span>}
          />
          <InfoRow
            label="Last activity"
            value={
              view.progress.lastActivityAt
                ? view.progress.lastActivityAt.toISOString()
                : <span className="opacity-50">none</span>
            }
          />
        </Card>

        <Card>
          <BlockTitle title="Campaign" className="mb-4 text-left" />
          <InfoRow label="Status" value={view.campaign.status} />
          <InfoRow
            label="Segments"
            value={
              view.campaign.targetSegments.length > 0
                ? view.campaign.targetSegments.join(", ")
                : <span className="opacity-50">none</span>
            }
          />
          <InfoRow
            label="Operator notes"
            value={
              view.campaign.operatorNotes
                ? view.campaign.operatorNotes
                : <span className="opacity-50">none</span>
            }
          />
          <InfoRow label="Created" value={view.campaign.createdAt.toISOString()} />
          <InfoRow label="Last update" value={view.campaign.updatedAt.toISOString()} />
        </Card>

        <Card>
          <BlockTitle title="Run discovery" className="mb-4 text-left" />
          <p className="text-sm font-light opacity-70 mb-4">
            Enqueue <code>job.run_campaign_discovery</code>. The agent searches for prospect organisations matching this campaign&apos;s segments + objective and emits proposals into the panels below.
          </p>
          <form action="/api/commands" method="post" className="space-y-3">
            <input type="hidden" name="commandType" value="run_campaign_discovery" />
            <input type="hidden" name="campaignId" value={view.campaign.id} />
            <textarea
              className={textareaClass}
              name="additionalGuidance"
              placeholder="Optional guidance for this run (regions to focus on, exclusions, etc.)"
              maxLength={4000}
            />
            <Button type="submit">Run discovery</Button>
          </form>

          {view.recentDiscoveryRuns.length > 0 ? (
            <div className="mt-6">
              <div className="text-xs uppercase tracking-[0.2em] opacity-60 mb-2">
                Recent runs
              </div>
              <ul className="space-y-1.5">
                {view.recentDiscoveryRuns.map((r) => (
                  <li key={r.jobId} className="flex justify-between items-center text-xs opacity-80">
                    <span>{r.createdAt.toISOString()}</span>
                    <Badge tone={r.jobStatus === "succeeded" ? "accent" : r.jobStatus === "failed" ? "danger" : "primary"}>
                      {r.jobStatus}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        {PANEL_ORDER.map((status) => {
          const list = view.candidatesByStatus[status];
          if (list.length === 0) return null;
          const display = STATUS_DISPLAY[status];
          return (
            <Card key={status}>
              <div className="flex items-center gap-3 mb-4">
                <BlockTitle title={display.label} className="text-left" />
                <Badge tone={display.tone}>{list.length}</Badge>
              </div>
              <ul className="space-y-3">
                {list.map((c) => (
                  <CandidateRow key={c.id} candidate={c} />
                ))}
              </ul>
            </Card>
          );
        })}
      </PageBody>
    </>
  );
}

function formatReplyClass(replyClass: string): string {
  return replyClass.replaceAll("_", " ");
}

function CandidateRow({ candidate }: { candidate: DiscoveryCandidateView }) {
  const isActionable =
    candidate.status === "proposed" ||
    candidate.status === "needs_review" ||
    candidate.status === "insufficient_fit";
  const isRejectable =
    isActionable || candidate.status === "duplicate";

  return (
    <li className="border border-white/10 rounded-xl p-4 bg-black/30 space-y-3">
      <div className="flex justify-between gap-3 items-start">
        <div className="min-w-0">
          <strong className="font-medium">{candidate.proposedName}</strong>
          <div className="text-xs opacity-60 mt-0.5">
            {candidate.domain ?? "no domain"}
            {candidate.countryCode ? ` · ${candidate.countryCode}` : ""}
            {candidate.region ? ` · ${candidate.region}` : ""}
            {candidate.confidence ? ` · ${candidate.confidence} confidence` : ""}
            {" · "}
            {candidate.dedupeResult} dedupe
          </div>
        </div>
      </div>

      {candidate.fitRationale ? (
        <p className="text-sm font-light opacity-90">{candidate.fitRationale}</p>
      ) : null}

      {candidate.matchedOrganizationId ? (
        <div className="text-xs opacity-70">
          Matched org:{" "}
          <Link
            href={`/organizations/${candidate.matchedOrganizationId}`}
            className="text-[hsl(var(--primary))]"
          >
            {candidate.matchedOrganizationName ?? candidate.matchedOrganizationId}
          </Link>
          {candidate.matchedOrganizationDomain ? ` (${candidate.matchedOrganizationDomain})` : ""}
        </div>
      ) : null}

      {candidate.rejectionReason || candidate.rejectionReasonCode ? (
        <div className="text-xs text-red-300/80">
          Rejection: {candidate.rejectionReasonCode ? formatDiscoveryRejectionReason(candidate.rejectionReasonCode) : "Policy"}
          {candidate.rejectionReason ? ` · ${candidate.rejectionReason}` : ""}
        </div>
      ) : null}

      {candidate.sourceRefs.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer opacity-60">{candidate.sourceRefs.length} source{candidate.sourceRefs.length === 1 ? "" : "s"}</summary>
          <ul className="mt-2 space-y-1 pl-3">
            {candidate.sourceRefs.map((s, i) => (
              <li key={i} className="break-all">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[hsl(var(--primary))]"
                >
                  {s.title ?? s.url}
                </a>
                {s.snippet ? <div className="opacity-60 italic">{s.snippet}</div> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {(isActionable || isRejectable) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-white/10">
          {isActionable ? (
            <form action="/api/commands" method="post" className="space-y-2">
              <input type="hidden" name="commandType" value="accept_discovery_candidate" />
              <input type="hidden" name="candidateId" value={candidate.id} />
              <input
                type="hidden"
                name="idempotencyKey"
                value={buildAcceptDiscoveryCandidateIdempotencyKey(candidate.id, candidate.updatedAt)}
              />
              <input
                className={inputClass}
                name="organizationName"
                placeholder={`Override name (default: ${candidate.proposedName})`}
              />
              <input
                className={inputClass}
                name="domain"
                placeholder={`Override domain (default: ${candidate.domain ?? "—"})`}
              />
              <Button type="submit" size="sm">Accept</Button>
            </form>
          ) : null}

          {isRejectable ? (
            <form action="/api/commands" method="post" className="space-y-2">
              <input type="hidden" name="commandType" value="reject_discovery_candidate" />
              <input type="hidden" name="candidateId" value={candidate.id} />
              <input
                type="hidden"
                name="idempotencyKey"
                value={buildRejectDiscoveryCandidateIdempotencyKey(candidate.id, candidate.updatedAt)}
              />
              <select className={inputClass} name="reasonCode" defaultValue="other">
                {discoveryRejectionReasonCodes.map((code) => (
                  <option key={code} value={code}>
                    {REJECTION_REASON_LABELS[code]}
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                name="reasonText"
                placeholder="Notes (optional)"
                maxLength={2000}
              />
              <Button type="submit" tone="danger" size="sm">Reject</Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function formatDiscoveryRejectionReason(code: string): string {
  return REJECTION_REASON_LABELS[code as DiscoveryRejectionReasonCode] ?? code;
}
