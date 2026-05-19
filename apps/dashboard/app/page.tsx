import { getDashboardSnapshot } from "@bizdev/db";
import { buildWorkItemActionIdempotencyKey } from "@bizdev/shared";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";

export const dynamic = "force-dynamic";

async function loadSnapshot() {
  try {
    return { data: await getDashboardSnapshot(), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    return { data: null, error: message };
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
  const campaigns = snapshot.data?.campaigns ?? [];
  const commands = snapshot.data?.commands ?? [];
  const jobs = snapshot.data?.jobs ?? [];
  const events = snapshot.data?.events ?? [];
  const webhookEvents = snapshot.data?.webhookEvents ?? [];
  const suppressions = snapshot.data?.suppressions ?? [];
  const workItems = snapshot.data?.workItems ?? [];

  return (
    <>
      <ConsoleHero
        eyebrow="Zero-autosend MVP"
        title="Operator Console"
        subtitle="Postgres-backed command/job/event foundation for campaign-driven outreach. Every outbound email remains operator-approved."
        actions={
          <>
            <PillLink href="/inbox" primary>
              Open Inbox
            </PillLink>
            <PillLink href="/campaigns">Campaigns</PillLink>
            <PillLink href="/organizations">Organizations</PillLink>
            <PillLink href="/drafts">Drafts</PillLink>
            <PillLink href="/policies">Policies</PillLink>
            <PillLink href="/operations">Operations</PillLink>
          </>
        }
      />

      <section className="max-w-[80vw] mx-auto px-4 pb-24 space-y-8">
        {snapshot.error ? (
          <Card className="border border-red-500/40">
            <BlockTitle title="Database unavailable" className="mb-2 text-left text-red-400" />
            <p className="text-sm font-light opacity-80">{snapshot.error}</p>
          </Card>
        ) : null}

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <MetricCard label="Campaigns" value={campaigns.length} />
          <MetricCard label="Commands" value={commands.length} />
          <MetricCard label="Jobs" value={jobs.length} />
          <MetricCard label="Events" value={events.length} />
          <MetricCard label="Webhooks" value={webhookEvents.length} />
          <MetricCard label="Suppressions" value={suppressions.length} />
          <MetricCard label="Work items" value={workItems.length} accent={workItems.length > 0} />
        </div>

        <Card>
          <BlockTitle title="Create campaign command" className="mb-4 text-left" />
          <form className="grid grid-cols-1 md:grid-cols-2 gap-3" action="/api/commands" method="post">
            <input
              name="name"
              placeholder="AI integration services outreach"
              required
              className="rounded-lg bg-[#1A1A1B] border border-white/10 p-3 text-sm md:col-span-2"
            />
            <textarea
              name="objective"
              placeholder="Sell our AI integration services to..."
              required
              rows={3}
              className="rounded-lg bg-[#1A1A1B] border border-white/10 p-3 text-sm md:col-span-2"
            />
            <button
              type="submit"
              className="rounded-lg bg-[var(--accent)] text-black font-bold py-3 hover:opacity-90 md:col-span-2"
            >
              Create command
            </button>
          </form>
        </Card>

        <Card>
          <BlockTitle title="Operator Inbox" className="mb-4 text-left" />
          {workItems.length === 0 ? (
            <p className="text-sm font-light opacity-60">
              No active work items. Webhook triage, suppression reviews, and draft approvals will appear here.
            </p>
          ) : (
            <ul className="space-y-3">
              {workItems.map((item) => (
                <li key={item.id} className="border border-white/10 rounded-xl p-4">
                  <div className="flex justify-between items-start gap-4 mb-2">
                    <div className="min-w-0">
                      <Link
                        href={`/work-items/${item.id}`}
                        className="text-base font-medium hover:text-[var(--accent)] hover:no-underline"
                      >
                        {item.title}
                      </Link>
                      <div className="text-xs opacity-60 mt-1">
                        {item.type} / {item.reasonCode}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="px-2 py-0.5 rounded-full bg-[var(--accent)] text-black text-xs font-bold">
                        {priorityBand(item.priority)}
                      </span>
                      <span className="text-xs opacity-60">{item.status}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
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
          )}
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <BlockTitle title="Recent jobs" className="mb-4 text-left" />
            <ul className="space-y-2">
              {jobs.map((job) => (
                <li key={job.id} className="flex justify-between border-b border-white/10 pb-2 last:border-b-0 text-sm">
                  <strong className="font-medium">{job.jobType}</strong>
                  <span className="text-xs opacity-60">
                    {job.status} / attempts {job.attempts}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <BlockTitle title="Recent campaigns" className="mb-4 text-left" />
            <ul className="space-y-2">
              {campaigns.map((campaign) => (
                <li key={campaign.id} className="flex justify-between border-b border-white/10 pb-2 last:border-b-0 text-sm">
                  <strong className="font-medium">{campaign.name}</strong>
                  <span className="text-xs opacity-60">{campaign.status}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <BlockTitle title="Recent webhook events" className="mb-4 text-left" />
            <ul className="space-y-2">
              {webhookEvents.map((event) => (
                <li key={event.id} className="flex justify-between border-b border-white/10 pb-2 last:border-b-0 text-sm">
                  <strong className="font-medium">{event.eventType}</strong>
                  <span className="text-xs opacity-60">
                    {event.status} / {event.recipientEmail ?? "no recipient"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <BlockTitle title="Active suppressions" className="mb-4 text-left" />
            <ul className="space-y-2">
              {suppressions.map((suppression) => (
                <li key={suppression.id} className="flex justify-between border-b border-white/10 pb-2 last:border-b-0 text-sm">
                  <strong className="font-medium">{suppression.email}</strong>
                  <span className="text-xs opacity-60">
                    {suppression.reason} / {suppression.source}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card>
          <BlockTitle title="Event log" className="mb-4 text-left" />
          <ul className="space-y-2">
            {events.map((event) => (
              <li key={event.id} className="flex justify-between border-b border-white/10 pb-2 last:border-b-0 text-sm">
                <strong className="font-medium">{event.eventType}</strong>
                <span className="text-xs opacity-60">
                  {event.entityType ?? "system"} / {event.entityId ?? "none"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </>
  );
}

function PillLink({ href, children, primary = false }: { href: string; children: React.ReactNode; primary?: boolean }) {
  const base = "px-5 py-2 rounded-[10px] text-sm font-semibold tracking-wide transition-colors hover:no-underline";
  const tone = primary
    ? "bg-[var(--accent)] text-black hover:opacity-90"
    : "bg-[#1A1A1B] border-b border-[#262626] text-white hover:bg-[#262626]";
  return (
    <Link href={href} className={`${base} ${tone}`}>
      {children}
    </Link>
  );
}

function MetricCard({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <Card className="min-h-0 p-5">
      <div className={`text-3xl font-bold ${accent ? "text-[var(--accent)]" : ""}`}>{value}</div>
      <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-2">{label}</div>
    </Card>
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
  extraInputs?: React.ReactNode;
}) {
  const cls =
    tone === "primary"
      ? "bg-[var(--accent)] text-black"
      : tone === "danger"
        ? "bg-[#7f2d20] text-white"
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
        className={`${cls} rounded-full px-3 py-1 text-xs font-bold hover:no-underline`}
      >
        {label}
      </button>
    </form>
  );
}
