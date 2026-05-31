import { getCampaignDiscoveryView } from "@bizdev/db";
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
  PageBody
} from "@/components/ui";
import { deriveCampaignStage, type CampaignStageSnapshot } from "@/lib/campaign-stage";
import { DismissableBanner } from "@/components/dismissable-banner";
import { AutoRefreshWhenActive } from "@/components/auto-refresh-when-active";
import {
  BackgroundActivityStrip,
  liveActivityTotal,
} from "@/components/background-activity-strip";
import { BackLink } from "@/components/back-link";
import { formatRelativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type CampaignDiscoveryViewModel = NonNullable<Awaited<ReturnType<typeof getCampaignDiscoveryView>>>;

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
  const noticeRaw = query["notice"];
  const noticeMessage = typeof noticeRaw === "string" ? noticeRaw : Array.isArray(noticeRaw) ? noticeRaw[0] : null;
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
        <div className="flex items-center gap-3 text-sm">
          <BackLink fallbackHref="/campaigns" label="← Back" />
          <span className="opacity-40">·</span>
          <span className="opacity-60">Campaign detail</span>
        </div>

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

        <StageStrip stage={stage} />

        <BackgroundActivityStrip activity={view.liveActivity} />

        <AutoRefreshWhenActive
          active={
            view.scopeValidation.state === "pending" ||
            liveActivityTotal(view.liveActivity) > 0
          }
        />

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <MetricCard
            label="Total candidates"
            value={totals}
            href={`/campaigns/${view.campaign.id}/candidates`}
            hint="Everything discovery has produced for this campaign — in every state."
          />
          <MetricCard
            label="Pending review"
            value={pending}
            accent={pending > 0}
            href={`/campaigns/${view.campaign.id}/candidates`}
            hint="Candidates waiting on you to accept or reject before anything else happens."
          />
          <MetricCard
            label="Researching"
            value={view.candidatesByStatus.queued_for_enrichment.length}
            href={`/campaigns/${view.campaign.id}/organizations`}
            hint="Accepted orgs whose research-snapshot agent is still running."
          />
          <MetricCard
            label="Research ready"
            value={view.candidatesByStatus.enriched.length}
            href={`/campaigns/${view.campaign.id}/organizations`}
            hint="Research snapshot finished. Waiting on contact approvals or drafts."
          />
          <MetricCard
            label="Closed"
            value={
              view.candidatesByStatus.duplicate.length +
              view.candidatesByStatus.insufficient_fit.length +
              view.candidatesByStatus.rejected_by_policy.length
            }
            href={`/campaigns/${view.campaign.id}/candidates`}
            hint="Rejected, duplicate, or insufficient-fit candidates. They no longer count toward the discovery cap."
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <MetricCard
            label="Contacts accepted"
            value={view.progress.contactsAccepted}
            hint="People you have approved into addressable contacts across all orgs in this campaign."
          />
          <MetricCard
            label="Drafts generated"
            value={view.progress.draftsGenerated}
            hint="Cold drafts the agent has produced. Each one needs your review before send."
          />
          <MetricCard
            label="Drafts approved"
            value={view.progress.draftsApproved}
            hint="Drafts you have signed off for sending. They sit in the send queue until the worker dispatches them."
          />
          <MetricCard
            label="Sent"
            value={view.progress.sent}
            hint="Messages dispatched through Resend. Awaiting delivery webhook + reply."
          />
          <MetricCard
            label="Replies"
            value={view.progress.replied}
            accent={view.progress.replied > 0}
            hint="Inbound replies attached to threads in this campaign."
          />
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

        <ScopeIncompleteCallout view={view} />

        <Card id="run-discovery">
          <BlockTitle title="Re-run discovery" className="mb-2 text-left" />
          <p className="text-sm font-light opacity-80 mb-4">
            The first discovery pass ran automatically when this campaign was created. Use this card to ask the
            discovery agent for more candidates — for example after you reject the ones you do not want, or after the
            cooldown has elapsed.
          </p>
          {!isActiveCampaign ? (
            <p className="text-sm font-light opacity-70">
              Discovery can run after the campaign scope is complete and the campaign is active.
            </p>
          ) : remainingDiscoveryCapacity <= 0 ? (
            <div className="space-y-3">
              <p className="text-sm font-light opacity-90">
                Discovery is full at {activeDiscoveryCount} of {view.campaign.maxOrganizationsToDiscover} organisations.
                The discovery agent will not surface more candidates until you free a slot.
              </p>
              <p className="text-sm font-light opacity-80">
                <strong>How to free slots:</strong> reject candidates you do not want from the Proposed / Needs review
                lists below. Each rejection opens one slot. Accepted candidates also count against the cap until they
                are closed out (rejected_by_policy, insufficient_fit, or duplicate).
              </p>
              <p className="text-xs font-light opacity-60">
                <strong>Why can&apos;t I just raise the cap?</strong> The cap (<code>max_organizations_to_discover</code>)
                is a scope field, and scope fields are only editable while the campaign is in <code>drafting_scope</code>.
                This is by design — it keeps the agent&apos;s output budget predictable per active campaign. Raising the
                cap on a live campaign requires a direct schema update; ask an engineer.
              </p>
              <span
                aria-disabled="true"
                className="inline-flex items-center rounded-lg border border-white/15 bg-white/[0.03] px-4 py-2.5 text-sm font-bold tracking-wide text-white/50 cursor-not-allowed"
              >
                Re-run discovery (cap reached)
              </span>
            </div>
          ) : view.liveActivity.discoveryRunning > 0 ? (
            <div className="space-y-3">
              <p className="text-sm font-light opacity-90">
                Discovery is already running for this campaign. Wait for it to finish — the page
                refreshes itself while the job is in flight. Re-run is disabled to avoid stacking a
                second agent call on top of the first.
              </p>
              <span
                aria-disabled="true"
                className="inline-flex items-center rounded-lg border border-white/15 bg-white/[0.03] px-4 py-2.5 text-sm font-bold tracking-wide text-white/50 cursor-not-allowed"
              >
                Re-run discovery (already running)
              </span>
            </div>
          ) : (
            <>
              <p className="text-sm font-light opacity-90 mb-4">
                Discovery has{" "}
                <strong>{remainingDiscoveryCapacity}</strong> of {view.campaign.maxOrganizationsToDiscover} slot
                {remainingDiscoveryCapacity === 1 ? "" : "s"} free. Re-running asks the agent for another batch (subject
                to the {view.campaign.cooldownBetweenDiscoverySeconds}s cooldown).
              </p>
              <form action="/api/commands" method="post" className="space-y-3">
                <input type="hidden" name="commandType" value="run_campaign_discovery" />
                <input type="hidden" name="campaignId" value={view.campaign.id} />
                <Button type="submit">Re-run discovery</Button>
              </form>
            </>
          )}

          {view.recentDiscoveryRuns.length > 0 ? (
            <div className="mt-6">
              <div className="text-xs uppercase tracking-[0.2em] opacity-60 mb-2">
                Recent runs
              </div>
              <ul className="space-y-1.5">
                {view.recentDiscoveryRuns.map((r) => {
                  const tone =
                    r.jobStatus === "succeeded"
                      ? "accent"
                      : r.jobStatus === "failed" || r.jobStatus === "dead_lettered"
                      ? "danger"
                      : "primary";
                  // For succeeded runs render an outcome summary; for non-terminal
                  // runs render the bare job status so the operator can tell the
                  // job is still in flight without parsing the badge.
                  const outcome =
                    r.jobStatus === "succeeded"
                      ? r.candidatesProduced === null
                        ? "completed"
                        : r.candidatesProduced === 0
                        ? "found 0 organisations"
                        : `found ${r.candidatesProduced} organisation${r.candidatesProduced === 1 ? "" : "s"}`
                      : r.jobStatus;
                  return (
                    <li key={r.jobId} className="flex justify-between items-center text-xs opacity-80">
                      <span>
                        <span className="font-semibold">{formatRelativeTime(r.createdAt)}</span>{" "}
                        <span className="opacity-70">· {outcome}</span>
                      </span>
                      <Badge tone={tone}>{r.jobStatus}</Badge>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </Card>

        <AcceptedOrganisationsCard view={view} />

      </PageBody>
    </>
  );
}

function formatListValue(values: string[]) {
  return values.length > 0 ? values.join(", ") : <span className="opacity-50">none</span>;
}

// T-026AH/A: surface the organisations the campaign has already produced
// so the operator can jump straight to their detail pages instead of
// hunting through the unrelated cross-campaign /organizations listing.
// "Accepted" here means the candidate is past triage and lives as an
// organisation — i.e. accepted, queued_for_enrichment, or enriched.
function AcceptedOrganisationsCard({ view }: { view: CampaignDiscoveryViewModel }) {
  const rows = [
    ...view.candidatesByStatus.enriched,
    ...view.candidatesByStatus.queued_for_enrichment,
    ...view.candidatesByStatus.accepted
  ].filter((c) => c.matchedOrganizationId !== null);

  if (rows.length === 0) {
    return null;
  }

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <BlockTitle title="Organisations" className="text-left" />
        <Badge tone="accent">{rows.length}</Badge>
        <Link
          href={`/campaigns/${view.campaign.id}/organizations`}
          className="ml-auto text-xs font-semibold tracking-[0.18em] uppercase text-[var(--accent)] hover:opacity-80 transition-opacity"
        >
          View all →
        </Link>
      </div>
      <p className="text-sm font-light opacity-70 mb-4">
        Candidates this campaign has accepted. Open one to review research, approve contacts, and generate
        drafts.
      </p>
      <ul className="space-y-2">
        {rows.map((c) => {
          const display = c.matchedOrganizationName ?? c.proposedName;
          const subtitle = [
            c.matchedOrganizationDomain ?? c.domain ?? "no domain",
            c.countryCode ?? null,
            c.region ?? null
          ].filter(Boolean).join(" · ");
          const statusTone =
            c.status === "enriched"
              ? "accent"
              : c.status === "queued_for_enrichment"
              ? "primary"
              : "default";
          const statusLabel =
            c.status === "enriched"
              ? "research ready"
              : c.status === "queued_for_enrichment"
              ? "enriching"
              : "accepted";
          return (
            <li key={c.id}>
              <Link
                href={`/organizations/${c.matchedOrganizationId}`}
                className="flex items-center justify-between gap-4 border border-white/10 rounded-xl px-4 py-3 hover:bg-white/[0.04] hover:no-underline transition-colors"
              >
                <div className="min-w-0">
                  <div className="font-medium">{display}</div>
                  <div className="text-xs opacity-60 mt-0.5">{subtitle}</div>
                </div>
                <Badge tone={statusTone}>{statusLabel}</Badge>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// T-026AK/B: render only when the validator has actually rejected the
// scope (state === 'incomplete'). During the validation-pending race
// window the StageStrip already informs the operator that the
// background job is running; an extra "Fix scope" card here would just
// look broken.
function ScopeIncompleteCallout({ view }: { view: CampaignDiscoveryViewModel }) {
  if (view.scopeValidation.state !== "incomplete") {
    return null;
  }
  const missing = view.scopeValidation.missingFields;
  return (
    <div className="rounded-2xl border border-yellow-500/40 bg-yellow-500/5 p-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-3">
          <div className="text-xs font-semibold tracking-[0.2em] uppercase text-yellow-400">
            Scope incomplete
          </div>
          <p className="text-sm font-light opacity-90 max-w-2xl">
            The validator rejected the campaign brief. The campaign sits in <code>drafting_scope</code>
            until the missing fields are filled in. Discovery does not run from this state.
          </p>
          {missing.length > 0 ? (
            <p className="text-xs font-light opacity-80">
              Missing: {missing.map((f, i) => (
                <span key={f}>
                  {i > 0 ? ", " : ""}
                  <code className="font-mono">{f}</code>
                </span>
              ))}
            </p>
          ) : null}
        </div>
        <Link
          href={`/campaigns/${view.campaign.id}/scope`}
          className="shrink-0 px-5 py-2 rounded-[10px] text-sm font-semibold tracking-wide bg-[var(--accent)] text-black hover:opacity-90 transition-colors"
        >
          Open scope editor →
        </Link>
      </div>
    </div>
  );
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

function formatReplyClass(replyClass: string): string {
  return replyClass.replaceAll("_", " ");
}

