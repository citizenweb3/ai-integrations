import { getOperationsCounters } from "@bizdev/db";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import { Badge, MetricCard, PageBody, PillLink } from "@/components/ui";

export const dynamic = "force-dynamic";

function fmtAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function fmtDate(value: Date | null): string {
  if (!value) return "n/a";
  return value.toISOString().slice(0, 19).replace("T", " ");
}

export default async function OperationsPage() {
  const counters = await getOperationsCounters();
  const sendsPause = counters.sendsPause;
  const totalJobs = Object.values(counters.jobs.byStatus).reduce((a, b) => a + b, 0);
  const queuedJobs = counters.jobs.byStatus.queued ?? 0;
  const leasedJobs = counters.jobs.byStatus.leased ?? 0;
  const runningJobs = counters.jobs.byStatus.running ?? 0;
  const deadLetteredJobs = counters.jobs.byStatus.dead_lettered ?? 0;
  const failedJobs = counters.jobs.byStatus.failed ?? 0;

  return (
    <>
      <ConsoleHero currentNav="operations"
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            / Operations
          </>
        }
        title="Operations"
        subtitle={`Worker heartbeats, job queue depth, webhook backlog, and triage counters. Snapshot generated at ${counters.generatedAt.toISOString()}.`}
      />

      <PageBody>
        <div className="flex flex-wrap gap-2">
          <PillLink href="/operations/events">Event feed</PillLink>
        </div>

        {sendsPause.paused ? (
          <div className="rounded-lg border border-red-400/40 bg-red-950/30 p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-red-200">Sends paused</div>
                <div className="mt-1 text-sm opacity-80">
                  Since {fmtDate(sendsPause.pausedAt ?? sendsPause.updatedAt)} · reason: {sendsPause.reason ?? "n/a"}
                  {sendsPause.expiresAt ? ` · expires ${fmtDate(sendsPause.expiresAt)}` : ""}
                </div>
              </div>
              <form method="post" action="/api/commands">
                <input type="hidden" name="commandType" value="resume_all_sends" />
                <button
                  type="submit"
                  className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90"
                >
                  Resume sends
                </button>
              </form>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCardWithSub
            label="Workers"
            value={counters.workers.length}
            sub={`${counters.workers.filter((w) => w.healthy).length} healthy / ${counters.workers.filter((w) => !w.healthy).length} stale`}
          />
          <MetricCardWithSub
            label="Jobs queued"
            value={queuedJobs}
            sub={`leased ${leasedJobs} / running ${runningJobs} / total ${totalJobs}`}
          />
          <MetricCardWithSub
            label="Stale leases"
            value={counters.jobs.staleLeasedCount}
            sub="recovered on next worker tick"
            danger={counters.jobs.staleLeasedCount > 0}
          />
          <MetricCardWithSub
            label="Dead-lettered"
            value={deadLetteredJobs}
            sub={`${failedJobs} transient failures`}
            danger={deadLetteredJobs > 0}
          />
          <MetricCardWithSub
            label="Webhook backlog"
            value={counters.webhooks.backlogCount}
            sub="unprocessed"
            warning={counters.webhooks.backlogCount > 0}
          />
          <MetricCardWithSub
            label="Open ambiguity"
            value={counters.workItemsOpen.sendAmbiguityReview + counters.workItemsOpen.threadMatchAmbiguous}
            sub={`send ${counters.workItemsOpen.sendAmbiguityReview} / thread ${counters.workItemsOpen.threadMatchAmbiguous}`}
          />
          <MetricCard label="Policy blockers" value={counters.workItemsOpen.policyBlocker} />
          <MetricCard label="Unmatched inbound" value={counters.workItemsOpen.unmatchedInbound} />
        </div>

        <Card>
          <BlockTitle title="Incident response" className="mb-4 text-left" />
          <form method="post" action="/api/commands" className="grid gap-4 md:grid-cols-[1fr_220px_auto] md:items-end">
            <input type="hidden" name="commandType" value="pause_all_sends" />
            <label className="block text-sm">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] opacity-60">Pause reason</span>
              <input
                name="reason"
                required
                minLength={3}
                maxLength={2000}
                placeholder="Resend incident, compliance review, bad campaign data..."
                className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] opacity-60">Expires at</span>
              <input
                name="expiresAt"
                type="datetime-local"
                className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-400"
            >
              Pause sends
            </button>
          </form>
        </Card>

        <Card>
          <BlockTitle title="Worker heartbeats" className="mb-4 text-left" />
          {counters.workers.length === 0 ? (
            <p className="text-sm font-light opacity-60">No workers have reported a heartbeat yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-white/10 text-xs uppercase tracking-wider opacity-60">
                    <th className="py-2 font-medium">Worker</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 font-medium">Last seen</th>
                    <th className="py-2 font-medium">Age</th>
                    <th className="py-2 font-medium">Health</th>
                  </tr>
                </thead>
                <tbody>
                  {counters.workers.map((w) => (
                    <tr key={w.workerId} className="border-b border-white/5">
                      <td className="py-2 font-mono text-xs">{w.workerId}</td>
                      <td className="py-2">{w.status}</td>
                      <td className="py-2 text-xs opacity-80">
                        {new Date(w.lastSeenAt).toISOString().slice(0, 19).replace("T", " ")}
                      </td>
                      <td className="py-2 opacity-80">{fmtAge(w.ageSeconds)}</td>
                      <td className="py-2">
                        <Badge tone={w.healthy ? "accent" : "danger"}>{w.healthy ? "healthy" : "stale"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <BlockTitle title="Jobs queued by type" className="mb-4 text-left" />
            {counters.jobs.byTypeQueued.length === 0 ? (
              <p className="text-sm font-light opacity-60">No queued jobs.</p>
            ) : (
              <ul className="space-y-2">
                {counters.jobs.byTypeQueued.map((r) => (
                  <li key={r.jobType} className="flex justify-between border-b border-white/10 pb-2 last:border-b-0 text-sm">
                    <Link
                      href={`/operations/jobs/${encodeURIComponent(r.jobType)}`}
                      className="font-mono text-xs hover:text-[var(--accent)]"
                    >
                      {r.jobType}
                    </Link>
                    <span className="font-medium">{r.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <BlockTitle title="Dead-lettered by type" className="mb-4 text-left" />
            {counters.jobs.deadLetteredByType.length === 0 ? (
              <p className="text-sm font-light opacity-60">No dead-lettered jobs.</p>
            ) : (
              <ul className="space-y-2">
                {counters.jobs.deadLetteredByType.map((r) => (
                  <li key={r.jobType} className="flex justify-between border-b border-white/10 pb-2 last:border-b-0 text-sm">
                    <Link
                      href={`/operations/jobs/${encodeURIComponent(r.jobType)}`}
                      className="font-mono text-xs hover:text-[var(--accent)]"
                    >
                      {r.jobType}
                    </Link>
                    <span className="font-medium text-red-400">{r.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <BlockTitle title="Webhook events by status" className="mb-4 text-left" />
            {Object.keys(counters.webhooks.byStatus).length === 0 ? (
              <p className="text-sm font-light opacity-60">No webhook events recorded.</p>
            ) : (
              <ul className="space-y-2">
                {Object.entries(counters.webhooks.byStatus).map(([status, count]) => (
                  <li key={status} className="flex justify-between border-b border-white/10 pb-2 last:border-b-0 text-sm">
                    <code className="font-mono text-xs">{status}</code>
                    <span className="font-medium">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </PageBody>
    </>
  );
}

function MetricCardWithSub({
  label,
  value,
  sub,
  danger = false,
  warning = false
}: {
  label: string;
  value: number;
  sub: string;
  danger?: boolean;
  warning?: boolean;
}) {
  const valueClass = danger ? "text-red-400" : warning ? "text-yellow-400" : "";
  return (
    <div className="rounded-2xl bg-white/5 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
      <div className={`text-3xl font-bold ${valueClass}`}>{value}</div>
      <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-2">{label}</div>
      <div className="text-xs opacity-50 mt-2 font-light">{sub}</div>
    </div>
  );
}
