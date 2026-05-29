import Link from "next/link";
import type { OrganizationListItem } from "@bizdev/db";
import Card from "@/components/card";

// T-026AO/D: shared org listing card. Lifted from /organizations
// (which became a hub) so the per-campaign organisations subpage can
// render the same card without duplication.
//
// The campaign-tag block stays in the component but only renders when
// `showCampaignTags` is true. The per-campaign subpage hides them
// because every row is implicitly scoped to the same campaign; a
// future global-list page can re-enable them by passing `true`.

export function OrgListingCard({
  org,
  showCampaignTags = false
}: {
  org: OrganizationListItem;
  showCampaignTags?: boolean;
}) {
  return (
    <Link
      href={`/organizations/${org.id}`}
      className="block hover:no-underline"
    >
      <Card className="h-full hover:bg-white/10 transition-colors">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <h3 className="text-xl font-bold tracking-[0.02em] truncate">{org.name}</h3>
            <div className="text-sm font-light opacity-70 mt-1 truncate">
              {org.domain ?? "no domain"}
              {org.countryCode ? ` · ${org.countryCode}` : ""}
            </div>
          </div>
          {org.latestSnapshotVersion ? (
            <SnapshotBadge
              version={org.latestSnapshotVersion}
              status={org.latestSnapshotStatus ?? "draft"}
            />
          ) : (
            <span className="text-xs px-2 py-1 rounded-full border border-white/15 opacity-60">
              no snapshot
            </span>
          )}
        </div>

        {showCampaignTags && org.campaigns.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {org.campaigns.map((c) => (
              <span
                key={c.id}
                className="text-[10px] tracking-[0.12em] uppercase border border-[hsl(var(--primary))]/40 text-[hsl(var(--primary))] px-2 py-0.5 rounded-full"
                title={`Source campaign: ${c.name}`}
              >
                {c.name}
              </span>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-4 gap-4 mt-6">
          <Stat label="Contacts" value={org.contactCount} />
          <Stat
            label="Pending review"
            value={org.pendingContactCandidateCount}
            highlight={org.pendingContactCandidateCount > 0}
          />
          <Stat label="Threads" value={org.threadCount} />
          <Stat
            label="Open items"
            value={org.openWorkItemCount}
            highlight={org.openWorkItemCount > 0}
          />
        </div>
      </Card>
    </Link>
  );
}

function SnapshotBadge({ version, status }: { version: number; status: string }) {
  const tone = status === "approved"
    ? "text-[var(--accent)] border-[var(--accent)]/40"
    : "text-[hsl(var(--primary))] border-[hsl(var(--primary))]/40";
  return (
    <span className={`text-xs px-2 py-1 rounded-full border ${tone} whitespace-nowrap`}>
      v{version} · {status}
    </span>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <div className={`text-2xl font-bold ${highlight ? "text-[var(--accent)]" : ""}`}>{value}</div>
      <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-1">{label}</div>
    </div>
  );
}
