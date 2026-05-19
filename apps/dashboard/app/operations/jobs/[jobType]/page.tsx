import { getJobsByType } from "@bizdev/db";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import { PageBody } from "@/components/ui";

export const dynamic = "force-dynamic";

const PAGE_LIMIT = 50;

const STATUS_GROUPS: { label: string; statuses: string[] }[] = [
  { label: "Dead-lettered", statuses: ["dead_lettered"] },
  { label: "Failed (transient)", statuses: ["failed"] },
  { label: "Leased / running", statuses: ["leased", "running"] },
  { label: "Queued", statuses: ["queued"] },
  { label: "Succeeded (recent)", statuses: ["succeeded"] },
  { label: "Cancelled", statuses: ["cancelled"] }
];

function fmtDate(d: Date | null): string {
  return d ? new Date(d).toISOString().slice(0, 19).replace("T", " ") : "—";
}

function truncate(text: string | null, n = 240): string {
  if (!text) return "—";
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

export default async function JobsByTypePage({
  params
}: {
  params: Promise<{ jobType: string }>;
}) {
  const { jobType: rawJobType } = await params;
  const jobType = decodeURIComponent(rawJobType);
  const rows = await getJobsByType(jobType, PAGE_LIMIT);

  const grouped = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = grouped.get(r.status) ?? [];
    arr.push(r);
    grouped.set(r.status, arr);
  }

  const knownStatuses = new Set(STATUS_GROUPS.flatMap((g) => g.statuses));
  const orphanRows = rows.filter((r) => !knownStatuses.has(r.status));
  const groups = [
    ...STATUS_GROUPS,
    ...(orphanRows.length > 0
      ? [{ label: "Other", statuses: [...new Set(orphanRows.map((r) => r.status))] }]
      : [])
  ];

  return (
    <>
      <ConsoleHero
        eyebrow={
          <>
            <Link href="/operations" className="text-[hsl(var(--primary))]">
              Operations
            </Link>{" "}
            / Jobs
          </>
        }
        title={jobType}
        subtitle={`Recent ${PAGE_LIMIT} rows across the lifecycle. Sorted with dead-lettered and failed entries first so triage starts at the top of the page.`}
      />

      <PageBody>
        {rows.length === 0 ? (
          <Card>
            <p className="text-sm font-light opacity-60">No jobs found for this type.</p>
          </Card>
        ) : (
          groups.map((group) => {
            const groupRows = group.statuses.flatMap((s) => grouped.get(s) ?? []);
            if (groupRows.length === 0) return null;
            return (
              <Card key={group.label}>
                <BlockTitle
                  title={`${group.label} (${groupRows.length})`}
                  className="mb-4 text-left"
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left border-b border-white/10 uppercase tracking-wider opacity-60">
                        <th className="py-2 font-medium">Job ID</th>
                        <th className="py-2 font-medium">Status</th>
                        <th className="py-2 font-medium">Att.</th>
                        <th className="py-2 font-medium">Pool / pri</th>
                        <th className="py-2 font-medium">Avail.</th>
                        <th className="py-2 font-medium">Leased</th>
                        <th className="py-2 font-medium">Updated</th>
                        <th className="py-2 font-medium">Last error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupRows.map((r) => (
                        <tr key={r.id} className="border-b border-white/5 align-top">
                          <td className="py-2 font-mono">{r.id.slice(0, 8)}</td>
                          <td className="py-2">{r.status}</td>
                          <td className="py-2">
                            {r.attempts}/{r.maxAttempts}
                          </td>
                          <td className="py-2">
                            {r.workerPool} / {r.priority}
                          </td>
                          <td className="py-2 opacity-80">{fmtDate(r.availableAt)}</td>
                          <td className="py-2 opacity-80">
                            {r.leasedBy ? (
                              <>
                                <code className="font-mono">{r.leasedBy}</code>
                                <br />
                                until {fmtDate(r.leasedUntil)}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-2 opacity-80">{fmtDate(r.updatedAt)}</td>
                          <td
                            className={`py-2 max-w-[360px] break-all ${r.lastError ? "text-red-400" : "opacity-60"}`}
                          >
                            {truncate(r.lastError)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })
        )}
      </PageBody>
    </>
  );
}
