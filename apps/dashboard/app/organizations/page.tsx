import { listOrganizationsForDashboard } from "@bizdev/db";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";

export const dynamic = "force-dynamic";

export default async function OrganizationsIndexPage() {
  const orgs = await listOrganizationsForDashboard();

  return (
    <>
      <ConsoleHero currentNav="organizations"
        eyebrow={
          <>
            <Link href="/" className="text-[hsl(var(--primary))]">
              Operator Console
            </Link>{" "}
            / Organizations
          </>
        }
        title="Organizations"
        subtitle={`${orgs.length} tracked organisation${orgs.length === 1 ? "" : "s"}. Pick one to inspect its research snapshot, contacts, threads, and active work items.`}
      />

      <section className="max-w-[80vw] mx-auto px-4 pb-24">
        {orgs.length === 0 ? (
          <Card>
            <p className="font-light opacity-80">
              No organisations yet. Run a campaign — research_snapshot inserts orgs as it goes.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {orgs.map((org) => (
              <Link
                key={org.id}
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

                  <div className="grid grid-cols-3 gap-4 mt-6">
                    <Stat label="Contacts" value={org.contactCount} />
                    <Stat label="Threads" value={org.threadCount} />
                    <Stat
                      label="Open items"
                      value={org.openWorkItemCount}
                      highlight={org.openWorkItemCount > 0}
                    />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function SnapshotBadge({ version, status }: { version: number; status: string }) {
  const tone = status === "approved" ? "text-[var(--accent)] border-[var(--accent)]/40" : "text-[hsl(var(--primary))] border-[hsl(var(--primary))]/40";
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
