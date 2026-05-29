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
import type { ReactNode } from "react";
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
import { deriveCampaignStage, type CampaignStageSnapshot } from "@/lib/campaign-stage";

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

type CampaignDiscoveryViewModel = NonNullable<Awaited<ReturnType<typeof getCampaignDiscoveryView>>>;

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
  const activeDiscoveryCount =
    view.candidatesByStatus.proposed.length +
    view.candidatesByStatus.accepted.length +
    view.candidatesByStatus.needs_review.length +
    view.candidatesByStatus.queued_for_enrichment.length +
    view.candidatesByStatus.enriched.length;
  const remainingDiscoveryCapacity = Math.max(
    0,
    view.campaign.maxOrganizationsToDiscover - activeDiscoveryCount
  );
  const isActiveCampaign = view.campaign.status === "active";
  const isDraftingScope = view.campaign.status === "drafting_scope";
  const stage = deriveCampaignStage(view);
  // The first candidate panel rendered in the PANEL_ORDER loop gets the
  // `candidate-triage` anchor so the stage strip's "Review N candidates"
  // CTA jumps there. We need the loop to know which one is the first
  // present so we precompute it.
  const firstCandidatePanel = PANEL_ORDER.find(
    (status) => view.candidatesByStatus[status].length > 0
  );
  const replyClassBreakdown = Object.entries(view.progress.replyClassCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([replyClass, count]) => `${formatReplyClass(replyClass)}: ${count}`)
    .join(", ");

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
            / {view.campaign.name}
          </>
        }
        title={view.campaign.name}
        subtitle={view.campaign.objective}
      />

      <PageBody>
        {errorMessage ? (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-5">
            <div className="text-xs font-semibold tracking-[0.2em] uppercase text-red-400 mb-2">
              Last action failed
            </div>
            <p className="text-sm font-light opacity-90 break-words">{errorMessage}</p>
            <p className="text-xs font-light opacity-60 mt-3">
              Code + message returned by the command handler. Adjust scope or capacity and retry.
            </p>
          </div>
        ) : null}

        <StageStrip stage={stage} />

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
          <div className="flex items-center justify-between gap-4 mb-4">
            <BlockTitle title="Campaign" className="text-left" />
            {isDraftingScope ? <Badge tone="warning">Scope draft</Badge> : null}
          </div>
          <InfoRow label="Status" value={view.campaign.status} />
          <InfoRow
            label="Offer summary"
            value={
              view.campaign.offerSummary
                ? view.campaign.offerSummary
                : <span className="opacity-50">none</span>
            }
            className="items-start"
          />
          <InfoRow
            label="Desired CTA"
            value={
              view.campaign.desiredCta
                ? view.campaign.desiredCta
                : <span className="opacity-50">none</span>
            }
            className="items-start"
          />
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
          <InfoRow
            label="Forbidden claims"
            value={formatListValue(view.campaign.forbiddenClaims)}
          />
          <InfoRow
            label="Sender identity"
            value={view.campaign.senderIdentityId ?? <span className="opacity-50">none</span>}
          />
          <InfoRow
            label="Policy profile"
            value={view.campaign.policyProfileId ?? <span className="opacity-50">none</span>}
          />
          <InfoRow
            label="Discovery source hints"
            value={formatListValue(view.campaign.discoverySourceHints)}
          />
          <InfoRow
            label="Discovery exclusions"
            value={formatListValue(view.campaign.discoveryExclusions)}
          />
          <InfoRow
            label="Allowed regions"
            value={formatListValue(view.campaign.allowedRegions)}
          />
          <InfoRow
            label="Discovery cap"
            value={`${activeDiscoveryCount}/${view.campaign.maxOrganizationsToDiscover}`}
          />
          <InfoRow
            label="Discovery remaining"
            value={remainingDiscoveryCapacity}
          />
          <InfoRow
            label="Discovery cooldown"
            value={`${view.campaign.cooldownBetweenDiscoverySeconds}s`}
          />
          <InfoRow
            label="Concurrency caps"
            value={`enrich ${view.campaign.maxConcurrentEnrichments} / draft ${view.campaign.maxConcurrentDrafts} / review ${view.campaign.maxOpenDraftReviews}`}
          />
          <InfoRow label="Scope version" value={view.campaign.discoveryScopeVersion} />
          <InfoRow label="Created" value={view.campaign.createdAt.toISOString()} />
          <InfoRow label="Last update" value={view.campaign.updatedAt.toISOString()} />
        </Card>

        {isDraftingScope ? <CampaignScopeForm campaign={view.campaign} /> : null}

        <Card id="run-discovery">
          <BlockTitle title="Run discovery" className="mb-4 text-left" />
          {!isActiveCampaign ? (
            <p className="text-sm font-light opacity-70">
              Discovery can run after the campaign scope is complete and the campaign is active.
            </p>
          ) : remainingDiscoveryCapacity <= 0 ? (
            <div className="space-y-3">
              <p className="text-sm font-light opacity-90">
                Discovery cap reached: {activeDiscoveryCount} of {view.campaign.maxOrganizationsToDiscover} candidate
                slots are filled. Each non-terminal candidate (proposed, needs review, accepted, queued, enriched)
                counts against the cap.
              </p>
              <p className="text-xs font-light opacity-60">
                To find more organisations:{" "}
                <strong>reject</strong> candidates you do not want, or wait for accepted ones to be closed out by the
                operator. The campaign cap (<code>max_organizations_to_discover</code>) was set when the scope was
                drafted; raising it on a live campaign requires a direct schema update.
              </p>
              <Button type="button" tone="muted" className="opacity-60 cursor-not-allowed">
                Run discovery (cap reached)
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm font-light opacity-70 mb-4">
                Enqueue <code>job.run_campaign_discovery</code> using the persisted campaign scope.
                {" "}
                <span className="opacity-70">
                  Remaining capacity: {remainingDiscoveryCapacity} / {view.campaign.maxOrganizationsToDiscover}.
                </span>
              </p>
              <form action="/api/commands" method="post" className="space-y-3">
                <input type="hidden" name="commandType" value="run_campaign_discovery" />
                <input type="hidden" name="campaignId" value={view.campaign.id} />
                <Button type="submit">Run discovery</Button>
              </form>
            </>
          )}

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
            <Card key={status} id={status === firstCandidatePanel ? "candidate-triage" : undefined}>
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

function formatListValue(values: string[]) {
  return values.length > 0 ? values.join(", ") : <span className="opacity-50">none</span>;
}

function formatMultilineValue(values: string[]) {
  return values.join("\n");
}

// T-026AD: the "you are here" strip that lives at the top of the campaign
// detail page. The stage + CTA are derived in `deriveCampaignStage` from the
// already-loaded view; this component is just the visual primitive.
function StageStrip({ stage }: { stage: CampaignStageSnapshot }) {
  const action = stage.nextAction;
  const ctaIsAnchor = action?.href.startsWith("#");
  return (
    <Card>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-xs uppercase tracking-[0.2em] opacity-60">Stage</span>
            <Badge tone={stage.tone}>{stage.label}</Badge>
          </div>
          <p className="text-sm font-light opacity-90 max-w-2xl">{stage.description}</p>
        </div>
        {action ? (
          <div className="flex flex-col items-start md:items-end gap-2">
            {ctaIsAnchor ? (
              <a
                href={action.href}
                className="px-5 py-2 rounded-[10px] text-sm font-semibold tracking-wide bg-[var(--accent)] text-black hover:opacity-90 transition-colors"
              >
                {action.title}
              </a>
            ) : (
              <Link
                href={action.href}
                className="px-5 py-2 rounded-[10px] text-sm font-semibold tracking-wide bg-[var(--accent)] text-black hover:opacity-90 transition-colors"
              >
                {action.title}
              </Link>
            )}
            <p className="text-xs font-light opacity-60 max-w-xs text-left md:text-right">
              {action.hint}
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function CampaignScopeForm({ campaign }: { campaign: CampaignDiscoveryViewModel["campaign"] }) {
  return (
    <Card id="scope-form">
      <BlockTitle title="Edit scope" className="mb-4 text-left" />
      <form action="/api/commands" method="post" className="space-y-5">
        <input type="hidden" name="commandType" value="update_campaign_scope" />
        <input type="hidden" name="campaignId" value={campaign.id} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ScopeLabel label="Name">
            <input className={inputClass} name="name" defaultValue={campaign.name} required />
          </ScopeLabel>
          <ScopeLabel label="Objective">
            <input className={inputClass} name="objective" defaultValue={campaign.objective} required />
          </ScopeLabel>
        </div>

        <ScopeLabel label="Offer summary">
          <textarea
            className={textareaClass}
            name="offerSummary"
            defaultValue={campaign.offerSummary ?? ""}
            required
          />
        </ScopeLabel>

        <ScopeLabel label="Desired CTA">
          <textarea
            className={textareaClass}
            name="desiredCta"
            defaultValue={campaign.desiredCta ?? ""}
            required
          />
        </ScopeLabel>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ScopeLabel label="Target segments">
            <textarea
              className={textareaClass}
              name="targetSegments"
              defaultValue={formatMultilineValue(campaign.targetSegments)}
              required
            />
          </ScopeLabel>
          <ScopeLabel label="Forbidden claims">
            <textarea
              className={textareaClass}
              name="forbiddenClaims"
              defaultValue={formatMultilineValue(campaign.forbiddenClaims)}
            />
          </ScopeLabel>
        </div>

        <ScopeLabel label="Operator notes">
          <textarea
            className={textareaClass}
            name="operatorNotes"
            defaultValue={campaign.operatorNotes ?? ""}
          />
        </ScopeLabel>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ScopeLabel label="Source hints">
            <textarea
              className={textareaClass}
              name="discoverySourceHints"
              defaultValue={formatMultilineValue(campaign.discoverySourceHints)}
            />
          </ScopeLabel>
          <ScopeLabel label="Exclusions">
            <textarea
              className={textareaClass}
              name="discoveryExclusions"
              defaultValue={formatMultilineValue(campaign.discoveryExclusions)}
            />
          </ScopeLabel>
          <ScopeLabel label="Allowed regions">
            <textarea
              className={textareaClass}
              name="allowedRegions"
              defaultValue={formatMultilineValue(campaign.allowedRegions)}
            />
          </ScopeLabel>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ScopeLabel label="Sender identity ID">
            <input className={inputClass} name="senderIdentityId" defaultValue={campaign.senderIdentityId ?? ""} />
          </ScopeLabel>
          <ScopeLabel label="Policy profile ID">
            <input className={inputClass} name="policyProfileId" defaultValue={campaign.policyProfileId ?? ""} />
          </ScopeLabel>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <ScopeLabel label="Org cap">
            <input
              className={inputClass}
              type="number"
              min={1}
              name="maxOrganizationsToDiscover"
              defaultValue={campaign.maxOrganizationsToDiscover}
            />
          </ScopeLabel>
          <ScopeLabel label="Enrich cap">
            <input
              className={inputClass}
              type="number"
              min={1}
              name="maxConcurrentEnrichments"
              defaultValue={campaign.maxConcurrentEnrichments}
            />
          </ScopeLabel>
          <ScopeLabel label="Draft cap">
            <input
              className={inputClass}
              type="number"
              min={1}
              name="maxConcurrentDrafts"
              defaultValue={campaign.maxConcurrentDrafts}
            />
          </ScopeLabel>
          <ScopeLabel label="Review cap">
            <input
              className={inputClass}
              type="number"
              min={1}
              name="maxOpenDraftReviews"
              defaultValue={campaign.maxOpenDraftReviews}
            />
          </ScopeLabel>
        </div>

        <ScopeLabel label="Discovery cooldown seconds" className="max-w-xs">
          <input
            className={inputClass}
            type="number"
            min={0}
            name="cooldownBetweenDiscoverySeconds"
            defaultValue={campaign.cooldownBetweenDiscoverySeconds}
          />
        </ScopeLabel>

        <Button type="submit">Save scope</Button>
      </form>
    </Card>
  );
}

function ScopeLabel({
  label,
  className = "",
  children
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block space-y-2 ${className}`}>
      <span className="block text-xs uppercase tracking-[0.18em] opacity-70">{label}</span>
      {children}
    </label>
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
              <input
                className={inputClass}
                name="countryCode"
                maxLength={2}
                placeholder={`Override country, 2-letter (default: ${candidate.countryCode ?? "—"})`}
              />
              <label className="flex items-center gap-2 text-xs opacity-80">
                <input type="checkbox" name="skipEnrichment" />
                Skip research enrichment (org already has a fresh snapshot)
              </label>
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
