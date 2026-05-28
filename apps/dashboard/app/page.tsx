import { getCampaignsNeedingReview, getDashboardSnapshot } from "@bizdev/db";
import { buildWorkItemActionIdempotencyKey } from "@bizdev/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import ConsoleHero from "@/components/console-hero";
import {
  ActivityList,
  Badge,
  PillLink,
  SectionLabel,
  SecondaryStat,
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
    // DB-unavailable banner already surfaces the snapshot failure; the review
    // section silently disappears rather than throwing the whole page.
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
  const businessJobs = snapshot.data?.businessJobs ?? [];
  const businessEvents = snapshot.data?.businessEvents ?? [];
  const systemJobsTotal = snapshot.data?.systemJobsTotal ?? 0;
  const workItems = snapshot.data?.workItems ?? [];
  const webhookEvents = snapshot.data?.webhookEvents ?? [];
  const suppressions = snapshot.data?.suppressions ?? [];

  const reviewQueueTotal = reviewQueue.reduce((s, c) => s + c.needsReview + c.proposed, 0);
  const urgentWorkItems = workItems.filter((w) => w.priority >= 90).length;

  return (
    <>
      <ConsoleHero
        currentNav="console"
        eyebrow="Operator Console · v0.1"
        title="BizDev Outreach"
        subtitle="Zero-autosend. Every email approved by hand. Postgres-coordinated commands, jobs, events — one operator, one decision at a time."
      />
      <section className="max-w-7xl mx-auto px-6 pb-24 space-y-14">
        {snapshot.error ? (
          <div className="border border-red-500/40 bg-red-500/5 p-5 rounded-md">
            <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-red-400 mb-2">
              Database unavailable
            </div>
            <p className="text-sm opacity-80">{snapshot.error}</p>
          </div>
        ) : null}

        {/* TRIAGE — primary attention surface */}
        <section>
          <SectionLabel meta="prioritized">Needs your attention</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TriageCallout
              label="Work items"
              value={workItems.length}
              sublabel={
                urgentWorkItems > 0
                  ? `${urgentWorkItems} urgent (P0)`
                  : workItems.length === 0
                    ? "All clear"
                    : "review queued"
              }
              tone={urgentWorkItems > 0 ? "danger" : workItems.length > 0 ? "accent" : "neutral"}
              href="/inbox"
            />
            <TriageCallout
              label="Discovery review"
              value={reviewQueueTotal}
              sublabel={
                reviewQueue.length === 0
                  ? "No campaigns awaiting"
                  : `across ${reviewQueue.length} campaign${reviewQueue.length === 1 ? "" : "s"}`
              }
              tone={reviewQueueTotal > 0 ? "accent" : "neutral"}
              href={reviewQueue[0] ? `/campaigns/${reviewQueue[0].campaignId}` : "/campaigns"}
            />
            <TriageCallout
              label="Operator activity"
              value={businessJobs.length}
              sublabel={
                businessJobs.length === 0
                  ? "no jobs yet — start a campaign"
                  : "recent business jobs"
              }
              tone={businessJobs.length > 0 ? "accent" : "neutral"}
              href="/operations"
            />
          </div>
          {systemJobsTotal > 0 ? (
            <p className="font-mono text-[10px] tracking-[0.2em] uppercase opacity-40 mt-5 pl-1">
              + {systemJobsTotal} background housekeeping job{systemJobsTotal === 1 ? "" : "s"} (cron, watchdogs) hidden
            </p>
          ) : null}
        </section>

        {/* QUICK ACTIONS */}
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
            <PillLink href="/operations/events">Event log</PillLink>
          </div>
        </section>

        {/* REVIEW QUEUE — only when non-empty */}
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
                    className="flex items-center justify-between gap-4 px-4 py-3 rounded-md bg-[var(--surface-1)] border border-white/[0.06] hover:border-[var(--accent)]/40 hover:no-underline transition-colors"
                  >
                    <span className="flex items-baseline gap-3 min-w-0">
                      <span className="font-mono text-[10px] tracking-[0.15em] uppercase opacity-40 shrink-0">
                        {c.campaignStatus}
                      </span>
                      <span className="font-medium truncate">{c.campaignName}</span>
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

        {/* OPERATOR INBOX — work items with action forms */}
        {workItems.length > 0 ? (
          <section>
            <SectionLabel meta={`${workItems.length} ${workItems.length === 1 ? "item" : "items"}`}>
              Operator inbox
            </SectionLabel>
            <ul className="space-y-3">
              {workItems.map((item) => (
                <li
                  key={item.id}
                  className="border border-white/[0.07] bg-[var(--surface-1)] rounded-md p-5"
                >
                  <div className="flex justify-between items-start gap-4 mb-4">
                    <div className="min-w-0">
                      <Link
                        href={`/work-items/${item.id}`}
                        className="text-base font-medium hover:text-[var(--accent)] hover:no-underline"
                      >
                        {item.title}
                      </Link>
                      <div className="font-mono text-[10px] opacity-50 mt-1 tracking-[0.1em]">
                        {item.type} · {item.reasonCode}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="px-2 py-0.5 rounded-full bg-[var(--accent)] text-black font-mono text-[10px] font-bold tracking-[0.15em]">
                        {priorityBand(item.priority)}
                      </span>
                      <span className="font-mono text-[10px] opacity-50">{item.status}</span>
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

        {/* ACTIVITY — operator jobs + events, side by side */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-10">
          <ActivityList
            title="Recent jobs"
            meta={businessJobs.length > 0 ? `${businessJobs.length}` : undefined}
            empty={`No operator-driven jobs yet.${systemJobsTotal > 0 ? ` ${systemJobsTotal} background housekeeping job${systemJobsTotal === 1 ? "" : "s"} hidden.` : ""}`}
            items={businessJobs.map((j) => ({
              id: j.id,
              primary: j.jobType,
              secondary: `${j.status} · attempts ${j.attempts}`
            }))}
          />
          <ActivityList
            title="Event log"
            meta={businessEvents.length > 0 ? `${businessEvents.length}` : undefined}
            empty="No operator-driven events yet. Cron job_started / job_succeeded ticks are hidden."
            items={businessEvents.map((e) => ({
              id: e.id,
              primary: e.eventType,
              secondary: `${e.entityType ?? "system"} · ${(e.entityId ?? "").slice(0, 8) || "—"}`
            }))}
          />
        </section>

        {/* CAMPAIGNS + WEBHOOKS + SUPPRESSIONS — compact reference */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-10">
          <div>
            <SectionLabel meta={campaigns.length > 0 ? `${campaigns.length}` : undefined}>
              Recent campaigns
            </SectionLabel>
            {campaigns.length === 0 ? (
              <p className="font-display italic text-sm opacity-60 px-1">
                No campaigns yet. Use “+ New campaign” to start.
              </p>
            ) : (
              <ul className="space-y-px">
                {campaigns.map((c) => (
                  <li
                    key={c.id}
                    className="flex justify-between items-baseline gap-3 px-3 py-2.5 bg-[var(--surface-1)]/60 border-l border-white/[0.06]"
                  >
                    <span className="font-medium truncate">{c.name}</span>
                    <span className="font-mono text-[10px] opacity-60 shrink-0">{c.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <SectionLabel meta={suppressions.length > 0 ? `${suppressions.length}` : undefined}>
              Active suppressions
            </SectionLabel>
            {suppressions.length === 0 ? (
              <p className="font-display italic text-sm opacity-60 px-1">
                None. Unsubscribes / complaints will surface here.
              </p>
            ) : (
              <ul className="space-y-px">
                {suppressions.map((s) => (
                  <li
                    key={s.id}
                    className="flex justify-between items-baseline gap-3 px-3 py-2.5 bg-[var(--surface-1)]/60 border-l border-white/[0.06]"
                  >
                    <span className="font-mono text-xs truncate">{s.email}</span>
                    <span className="font-mono text-[10px] opacity-50 shrink-0">
                      {s.reason} · {s.source}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* SYSTEM OVERVIEW — de-emphasized footer */}
        <section>
          <SectionLabel muted meta="reference">System overview</SectionLabel>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-3">
            <SecondaryStat label="Webhook events" value={webhookEvents.length} />
            <SecondaryStat label="Suppressions" value={suppressions.length} />
            <SecondaryStat label="Campaigns" value={campaigns.length} />
            <SecondaryStat label="Background jobs" value={systemJobsTotal} muted />
          </div>
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
        className={`${cls} rounded-full px-3 py-1 font-mono text-[10px] font-bold tracking-[0.15em] uppercase hover:no-underline transition-colors`}
      >
        {label}
      </button>
    </form>
  );
}
