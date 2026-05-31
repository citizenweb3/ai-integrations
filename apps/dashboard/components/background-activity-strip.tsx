// Shared "background work" banner. Renders nothing when no work is in
// flight; otherwise lists per-stage in-flight counts and tells the
// operator the page will keep refreshing. Originally lived inside
// /campaigns/[id]/page.tsx (T-026AD/B); extracted so the per-campaign
// /organizations subpage can render the same indicator instead of
// leaving the operator wondering whether discovery is still running.

export type LiveActivity = {
  discoveryRunning: number;
  researchInFlight: number;
  contactDiscoveryInFlight: number;
  draftingInFlight: number;
};

export function BackgroundActivityStrip({ activity }: { activity: LiveActivity }) {
  const items: Array<{ label: string; count: number }> = [
    { label: "Discovery", count: activity.discoveryRunning },
    { label: "Research", count: activity.researchInFlight },
    { label: "Contact discovery", count: activity.contactDiscoveryInFlight },
    { label: "Drafting", count: activity.draftingInFlight },
  ];
  const active = items.filter((item) => item.count > 0);
  if (active.length === 0) {
    return null;
  }
  return (
    <div className="rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--accent)]" />
          </span>
          <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[var(--accent)]">
            Background work
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {active.map((item) => (
            <span key={item.label} className="opacity-90">
              <span className="font-semibold">{item.count}</span>{" "}
              <span className="opacity-70">{item.label}</span>
            </span>
          ))}
        </div>
      </div>
      <p className="text-xs font-light opacity-60 mt-3">
        Agent jobs are running on the worker pool. The page auto-refreshes every 5 seconds while
        anything is in flight — leave it open and the counters will update on their own.
      </p>
    </div>
  );
}

export function liveActivityTotal(activity: LiveActivity): number {
  return (
    activity.discoveryRunning +
    activity.researchInFlight +
    activity.contactDiscoveryInFlight +
    activity.draftingInFlight
  );
}
