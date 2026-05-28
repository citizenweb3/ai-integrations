import { getCampaignsNeedingReview, getDashboardSnapshot } from "@bizdev/db";
import { buildWorkItemActionIdempotencyKey } from "@bizdev/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import {
  ActivityList,
  Badge,
  PillLink,
  SectionLabel,
  TriageCallout
} from "@/components/ui";

export const dynamic = "force-dynamic";

async function loadSnapshot() {
  try {
    return { data: await getDashboardSnapshot(), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    return { data: null, error: message };
  }
}

async function loadReviewQueue() {
  try {
    return await getCampaignsNeedingReview();
  } catch {
    return [];
  }
}

function priorityBand(priority: number) {
  if (priority >= 90) return "P0";
  if (priority >= 70) return "P1";
  if (priority >= 40) return "P2";
  return "P3";
}

export default async function DashboardHome() {
  const snapshot = await loadSnapshot();
  const reviewQueue = await loadReviewQueue();

  const campaigns = snapshot.data?.campaigns ?? [];
  const workItems = snapshot.data?.workItems ?? [];
  const suppressions = snapshot.data?.suppressions ?? [];

  const reviewQueueTotal = reviewQueue.reduce((s, c) => s + c.needsReview + c.proposed, 0);
  const urgentWorkItems = workItems.filter((w) => w.priority >= 90).length;
  const activeCampaigns = campaigns.filter((c) => c.status === "active").length;

  return (
    <>
      <ConsoleHero
        currentNav="console"
        eyebrow="Operator Console"
        title="BizDev Outreach"
        subtitle="Zero-autosend. Every outbound email is approved by hand. Postgres-coordinated commands, jobs and events — one operator, one decision at a time."
      />
      <section className="max-w-[88vw] mx-auto px-4 pb-24 space-y-10">
        {snapshot.error ? (
          <Card className="min-h-0 border border-red-500/40">
            <BlockTitle title="Database unavailable" className="mb-2 text-left text-red-400" />
            <p className="text-sm font-light opacity-80">{snapshot.error}</p>
          </Card>
        ) : null}

        {/* TRIAGE — what the operator should look at first. */}
        <section>
          <SectionLabel meta="prioritized">Needs your attention</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <TriageCallout
              label="Operator inbox"
              value={workItems.length}
              sublabel={
                urgentWorkItems > 0
                  ? `${urgentWorkItems} urgent (P0) waiting`
                  : workItems.length === 0
                    ? "All clear — no items to review"
                    : "Items waiting for action"
              }
              tone={urgentWorkItems > 0 ? "danger" : workItems.length > 0 ? "accent" : "neutral"}
              href="/inbox"
            />
            <TriageCallout
              label="Discovery review"
              value={reviewQueueTotal}
              sublabel={
                reviewQueue.length === 0
                  ? "No proposals awaiting triage"
                  : `Across ${reviewQueue.length} campaign${reviewQueue.length === 1 ? "" : "s"}`
              }
              tone={reviewQueueTotal > 0 ? "accent" : "neutral"}
              href={reviewQueue[0] ? `/campaigns/${reviewQueue[0].campaignId}` : "/campaigns"}
            />
            <TriageCallout
              label="Active campaigns"
              value={activeCampaigns}
              sublabel={
                campaigns.length === 0
                  ? "No campaigns yet — start one"
                  : activeCampaigns === 0
                    ? `${campaigns.length} drafting / paused`
                    : `${campaigns.length - activeCampaigns} other in scope`
              }
              tone={activeCampaigns > 0 ? "accent" : "neutral"}
              href="/campaigns"
            />
          </div>
        </section>

        {/* QUICK ACTIONS — fast entry points, no inline form on the home. */}
        <section>
          <SectionLabel>Quick actions</SectionLabel>
          <div className="flex flex-wrap gap-3">
            <PillLink href="/campaigns/new" primary>
              + New campaign
            </PillLink>
            <PillLink href="/campaigns">All campaigns</PillLink>
            <PillLink href="/inbox">Operator inbox</PillLink>
            <PillLink href="/drafts">Drafts queue</PillLink>
            <PillLink href="/organizations">Organizations</PillLink>
            <PillLink href="/operations/events">Event log →</PillLink>
          </div>
        </section>

        {/* REVIEW QUEUE — only when non-empty. */}
        {reviewQueue.length > 0 ? (
          <section>
            <SectionLabel meta={`${reviewQueue.length} ${reviewQueue.length === 1 ? "campaign" : "campaigns"}`}>
              Campaigns awaiting discovery review
            </SectionLabel>
            <ul className="space-y-2">
              {reviewQueue.map((c) => (
                <li key={c.campaignId}>
                  <Link
                    href={`/campaigns/${c.campaignId}`}
                    className="flex items-center justify-between gap-4 px-5 py-3 rounded-[10px] bg-[#1A1A1B] border-b border-[#262626] hover:bg-[#262626] hover:no-underline transition-colors"
                  >
                    <span className="flex items-baseline gap-3 min-w-0">
                      <span className="text-xs font-semibold tracking-[0.15em] uppercase opacity-50 shrink-0">
                        {c.campaignStatus}
                      </span>
                      <span className="text-sm font-medium truncate">{c.campaignName}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {c.needsReview > 0 ? (
                        <Badge tone="accent">{c.needsReview} needs review</Badge>
                      ) : null}
                      {c.proposed > 0 ? <Badge>{c.proposed} proposed</Badge> : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* OPERATOR INBOX — only when non-empty. */}
        {workItems.length > 0 ? (
          <section>
            <SectionLabel meta={`${workItems.length} ${workItems.length === 1 ? "item" : "items"}`}>
              Operator inbox
            </SectionLabel>
            <ul className="space-y-3">
              {workItems.map((item) => (
                <li
                  key={item.id}
                  className="rounded-2xl border border-white/10 bg-linear-to-t from-[#7C7C81]/15 to-[#1A1A1B]/25 p-5"
                >
                  <div className="flex justify-between items-start gap-4 mb-3">
                    <div className="min-w-0">
                      <Link
                        href={`/work-items/${item.id}`}
                        className="text-base font-medium hover:text-[var(--accent)] hover:no-underline"
                      >
                        {item.title}
                      </Link>
                      <div className="text-xs font-light opacity-60 mt-1">
                        {item.type} · {item.reasonCode}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="px-2 py-0.5 rounded-full bg-[var(--accent)] text-black text-xs font-bold tracking-[0.1em]">
                        {priorityBand(item.priority)}
                      </span>
                      <span className="text-xs font-light opacity-60">{item.status}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ActionForm itemId={item.id} updatedAt={item.updatedAt} action="resolve" label="Resolve" tone="primary" />
                    <ActionForm itemId={item.id} updatedAt={item.updatedAt} action="block" label="Block" tone="ghost" />
                    <ActionForm
                      itemId={item.id}
                      updatedAt={item.updatedAt}
                      action="snooze"
                      label="Snooze 1d"
                      tone="ghost"
                      extraInputs={<input type="hidden" name="snoozeMinutes" value="1440" />}
                    />
                    <ActionForm itemId={item.id} updatedAt={item.updatedAt} action="dismiss" label="Dismiss" tone="danger" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* RECENT CAMPAIGNS + ACTIVE SUPPRESSIONS — domain context, no system rows. */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ActivityList
            title="Recent campaigns"
            meta={campaigns.length > 0 ? `${campaigns.length}` : undefined}
            empty="No campaigns yet. Click “+ New campaign” to start one."
            items={campaigns.map((c) => ({
              id: c.id,
              primary: c.name,
              secondary: c.status,
              href: `/campaigns/${c.id}`
            }))}
          />
          <ActivityList
            title="Active suppressions"
            meta={suppressions.length > 0 ? `${suppressions.length}` : undefined}
            empty="None. Unsubscribes and complaints will surface here."
            items={suppressions.map((s) => ({
              id: s.id,
              primary: s.email,
              secondary: `${s.reason} · ${s.source}`
            }))}
          />
        </section>
      </section>
    </>
  );
}

function ActionForm({
  itemId,
  updatedAt,
  action,
  label,
  tone,
  extraInputs
}: {
  itemId: string;
  updatedAt: Date;
  action: "resolve" | "block" | "snooze" | "dismiss";
  label: string;
  tone: "primary" | "ghost" | "danger";
  extraInputs?: ReactNode;
}) {
  const cls =
    tone === "primary"
      ? "bg-[var(--accent)] text-black hover:opacity-90"
      : tone === "danger"
        ? "bg-[#7f2d20] text-white hover:opacity-90"
        : "bg-transparent border border-white/15 text-white hover:bg-white/5";
  return (
    <form action="/api/work-items" method="post" className="m-0">
      <input type="hidden" name="workItemId" value={itemId} />
      <input
        type="hidden"
        name="idempotencyKey"
        value={buildWorkItemActionIdempotencyKey(itemId, action, updatedAt)}
      />
      {extraInputs}
      <button
        type="submit"
        name="action"
        value={action}
        className={`${cls} rounded-full px-3 py-1 text-xs font-semibold tracking-[0.1em] uppercase hover:no-underline transition-colors`}
      >
        {label}
      </button>
    </form>
  );
}
