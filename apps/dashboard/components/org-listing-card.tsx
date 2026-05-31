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
              {org.discoveryWebsiteUrl ?? org.domain ?? "no domain"}
              {org.discoveryRegion
                ? ` · ${org.discoveryRegion}`
                : org.countryCode
                  ? ` · ${org.countryCode}`
                  : ""}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {org.latestSnapshotVersion ? (
              <SnapshotBadge version={org.latestSnapshotVersion} />
            ) : (
              <span
                className="text-xs px-2 py-1 rounded-full border border-white/15 opacity-60"
                title="The research-snapshot job has not finished yet. Drafts cannot use this org until it does."
              >
                no research yet
              </span>
            )}
            {org.addressableEmailCount > 0 ? (
              <span
                className="text-[10px] tracking-[0.18em] uppercase border border-[var(--accent)]/40 text-[var(--accent)] px-2 py-0.5 rounded-full whitespace-nowrap"
                title={`${org.addressableEmailCount} email address${org.addressableEmailCount === 1 ? "" : "es"} ready to use (approved contacts + pending candidates with email).`}
              >
                Addressable
              </span>
            ) : null}
          </div>
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

        {org.discoveryFitRationale ? (
          <p className="text-sm font-light opacity-75 leading-snug mt-2 line-clamp-3">
            {org.discoveryFitRationale}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-x-4 gap-y-5 mt-6">
          <Stat
            label="Approved contacts"
            hint="People you have approved as addressable. Drafts can use them as the recipient."
            value={org.contactCount}
          />
          <Stat
            label="Pending contacts"
            hint="People the agent found. Waiting on your Approve or Reject before drafts can use them."
            value={org.pendingContactCandidateCount}
            highlight={org.pendingContactCandidateCount > 0}
          />
          <Stat
            label="Threads"
            hint="Email conversations with this organisation. Increases when you start sending."
            value={org.threadCount}
          />
          <Stat
            label="Open items"
            hint="Tasks the system has flagged for you on this org (scope issues, draft reviews, …)."
            value={org.openWorkItemCount}
            highlight={org.openWorkItemCount > 0}
          />
        </div>
      </Card>
    </Link>
  );
}

function SnapshotBadge({ version }: { version: number }) {
  return (
    <span
      className="text-xs px-2 py-1 rounded-full border border-[hsl(var(--primary))]/40 text-[hsl(var(--primary))] whitespace-nowrap"
      title={`Research snapshot version ${version}. The number bumps every time you refresh the snapshot from the org page.`}
    >
      research v{version}
    </span>
  );
}

function Stat({
  label,
  hint,
  value,
  highlight = false
}: {
  label: string;
  hint?: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className={`text-2xl font-bold ${highlight ? "text-[var(--accent)]" : ""}`}>{value}</div>
      <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-1">{label}</div>
      {hint ? (
        <div className="text-[11px] font-light opacity-50 leading-snug mt-1">{hint}</div>
      ) : null}
    </div>
  );
}
