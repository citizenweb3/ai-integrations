import Link from "next/link";
import { researchFreshness, type ResearchFreshnessTier } from "@bizdev/shared";
import { formatRelativeTime } from "@/lib/format";
import { Badge } from "@/components/ui";

// G4.9 research-snapshot freshness. Renders a snapshot's relative age (with the
// absolute timestamp as a hover tooltip) and, once it crosses the aging/stale
// thresholds, a coloured badge so the operator can see at a glance that a draft
// may be grounding on outdated facts. Presentational only — the thresholds and
// tier logic live in `@bizdev/shared`.
const toneByTier: Record<Exclude<ResearchFreshnessTier, "fresh">, "warning" | "danger"> = {
  aging: "warning",
  stale: "danger"
};

export function SnapshotFreshness({
  createdAt,
  className
}: {
  createdAt: Date | string;
  className?: string;
}) {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const { tier, ageDays } = researchFreshness(created);
  const absolute = created.toISOString().slice(0, 19).replace("T", " ");
  return (
    <span className={className}>
      <span title={absolute}>{formatRelativeTime(created)}</span>
      {tier === "fresh" ? null : (
        <>
          {" "}
          <Badge tone={toneByTier[tier]}>
            {tier} · {ageDays}d
          </Badge>
        </>
      )}
    </span>
  );
}

// Draft-page warning callout: a draft grounds on its org's snapshot, so once
// that snapshot ages past the thresholds the operator is told the draft may be
// using outdated facts and is pointed at the org-scoped refresh affordance (the
// draft does not own the snapshot, so it links rather than duplicating the
// refresh command). Renders nothing while the snapshot is still fresh.
export function SnapshotStaleWarning({
  createdAt,
  orgId
}: {
  createdAt: Date | string;
  orgId: string;
}) {
  const { tier, ageDays } = researchFreshness(createdAt);
  if (tier === "fresh") {
    return null;
  }
  const stale = tier === "stale";
  return (
    <p
      className={`text-sm font-light rounded-xl border px-3 py-2 ${
        stale
          ? "border-red-500/40 text-red-300 bg-red-500/5"
          : "border-yellow-500/40 text-yellow-200 bg-yellow-500/5"
      }`}
    >
      Research is {ageDays} days old ({tier}). The draft may ground on outdated facts.{" "}
      <Link href={`/organizations/${orgId}`} className="underline hover:opacity-80">
        Refresh research on the org page
      </Link>
      .
    </p>
  );
}
