import { getOrganizationDetail } from "@bizdev/db";
import {
  buildApproveContactCandidateIdempotencyKey,
  buildSetPrimaryContactIdempotencyKey,
  contactRejectionReasonCodes,
  type ContactRejectionReasonCode
} from "@bizdev/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";

export const dynamic = "force-dynamic";

const CONTACT_REJECTION_REASON_LABELS: Record<ContactRejectionReasonCode, string> = {
  wrong_person: "Wrong person",
  left_company: "Left company",
  private_pii: "Private / PII",
  duplicate_of: "Duplicate",
  low_confidence: "Low confidence",
  other: "Other"
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OrganizationDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const org = await getOrganizationDetail(id);
  if (!org) {
    notFound();
  }
  const confirmCandidateId = singleQueryParam(query.confirmContactCandidateId);
  const confirmContactId = singleQueryParam(query.confirmContactId);
  const confirmExistingOrganizationId = singleQueryParam(query.confirmExistingOrganizationId);
  const confirmCandidateOrganizationId = singleQueryParam(query.confirmCandidateOrganizationId);
  const confirmEmail = singleQueryParam(query.confirmEmail);

  return (
    <>
      <ConsoleHero currentNav="organizations"
        eyebrow={
          <>
            <Link href="/organizations" className="text-[hsl(var(--primary))]">
              Organizations
            </Link>{" "}
            / Detail
          </>
        }
        title={org.name}
        subtitle={
          <>
            {org.domain ?? "no domain"}
            {org.countryCode ? ` · ${org.countryCode}` : ""}
          </>
        }
      />

      <section className="max-w-[80vw] mx-auto px-4 pb-24 space-y-8">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard label="Contacts" value={org.stats.contacts} />
          <StatCard label="Threads" value={org.stats.threads} />
          <StatCard label="Outreach" value={org.stats.outreachRecords} />
          <StatCard label="Sent" value={org.stats.sentOutbound} />
          <StatCard label="Replies" value={org.stats.inboundReplies} />
          <StatCard label="Open items" value={org.stats.openWorkItems} accent={org.stats.openWorkItems > 0} />
        </div>

        <SnapshotPanel snapshot={org.latestSnapshot} orgName={org.name} orgId={org.id} orgDomain={org.domain} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <BlockTitle title="Generate AI draft" className="mb-4 text-left" />
            <p className="text-sm font-light opacity-70 mb-4">
              Enqueues <code className="text-[var(--accent)]">job.generate_cold_draft</code>. Agent receives latest
              research_snapshot facts and must cite each claim by factId.
            </p>
            <form className="space-y-3" action="/api/commands" method="post">
              <input type="hidden" name="commandType" value="generate_draft" />
              <input type="hidden" name="organizationId" value={org.id} />
              <textarea
                name="operatorBrief"
                placeholder="Brief: angle, ask, voice, anything specific."
                required
                rows={4}
                className="w-full rounded-lg bg-[#1A1A1B] border border-white/10 p-3 text-sm font-light"
              />
              <input
                name="contactId"
                placeholder="Contact ID (UUID, optional)"
                className="w-full rounded-lg bg-[#1A1A1B] border border-white/10 p-3 text-sm"
              />
              <input
                name="campaignId"
                placeholder="Campaign ID (UUID, optional)"
                className="w-full rounded-lg bg-[#1A1A1B] border border-white/10 p-3 text-sm"
              />
              <button
                type="submit"
                className="w-full rounded-lg bg-[var(--accent)] text-black font-bold py-3 hover:opacity-90 transition-opacity"
              >
                Generate draft
              </button>
            </form>
          </Card>

          <Card>
            <BlockTitle title="Active work items" className="mb-4 text-left" />
            {org.workItems.length === 0 ? (
              <p className="text-sm font-light opacity-60">No open items.</p>
            ) : (
              <ul className="space-y-3">
                {org.workItems.map((w) => (
                  <li key={w.id} className="border-b border-white/10 pb-3 last:border-b-0">
                    <Link
                      href={`/work-items/${w.id}`}
                      className="text-base font-medium hover:text-[var(--accent)] hover:no-underline"
                    >
                      {w.title}
                    </Link>
                    <div className="text-xs opacity-60 mt-1">
                      {w.type} · {w.status} · p{w.priority}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <BlockTitle title="Threads" className="mb-4 text-left" />
          {org.threads.length === 0 ? (
            <p className="text-sm font-light opacity-60">No threads.</p>
          ) : (
            <ul className="space-y-2">
              {org.threads.map((t) => (
                <li key={t.id} className="flex justify-between items-center border-b border-white/10 pb-2 last:border-b-0 text-sm">
                  <Link href={`/threads/${t.id}`} className="font-mono text-xs opacity-90 hover:text-[var(--accent)]">
                    {t.id}
                  </Link>
                  <span className="text-xs opacity-60">
                    {t.status} · {new Date(t.updatedAt).toISOString().slice(0, 19).replace("T", " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <BlockTitle title="Contacts" className="mb-4 text-left" />
          {org.contacts.length === 0 ? (
            <p className="text-sm font-light opacity-60">No contacts.</p>
          ) : (
            <ul className="space-y-2">
              {org.contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap justify-between items-start gap-4 border-b border-white/10 pb-2 last:border-b-0 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium break-all">
                      {c.email}
                      {c.isPrimary ? (
                        <span className="ml-2 rounded-full border border-[var(--accent)]/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--accent)]">
                          primary
                        </span>
                      ) : null}
                    </div>
                    <div className="opacity-60">
                      {c.fullName ?? "—"}
                      {c.roleTitle ? ` · ${c.roleTitle}` : ""}
                    </div>
                  </div>
                  {c.isPrimary ? null : (
                    <form action="/api/commands" method="post" className="shrink-0">
                      <input type="hidden" name="commandType" value="set_primary_contact" />
                      <input type="hidden" name="organizationId" value={org.id} />
                      <input type="hidden" name="contactId" value={c.id} />
                      <input
                        type="hidden"
                        name="idempotencyKey"
                        value={buildSetPrimaryContactIdempotencyKey(org.id, c.id, org.updatedAt)}
                      />
                      <button
                        type="submit"
                        className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      >
                        Set primary
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <BlockTitle title="Pending contact candidates" className="mb-4 text-left" />
          <p className="text-sm font-light opacity-70 mb-4">
            Operator review queue from research_snapshot stage.
          </p>
          {org.pendingContactCandidates.length === 0 ? (
            <p className="text-sm font-light opacity-60">No pending candidates.</p>
          ) : (
            <ul className="space-y-4">
              {org.pendingContactCandidates.map((c) => (
                <li key={c.id} className="border border-white/10 rounded-xl p-4">
                  <div className="flex justify-between flex-wrap gap-2 mb-2">
                    <strong className="text-base">{c.fullName ?? "(no name)"}</strong>
                    <span className="text-xs opacity-60">
                      {confidenceLabel(c.confidence)}
                      {c.role ? ` · ${c.role}` : ""}
                      {c.source ? ` · ${c.source}` : ""}
                    </span>
                  </div>
                  <div className="text-sm opacity-80 mb-3">
                    {c.email ?? "(no email — supply one to approve)"}
                    {safeEvidenceHref(c.evidenceUrl) ? (
                      <>
                        {" · "}
                        <a
                          href={safeEvidenceHref(c.evidenceUrl) as string}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--accent)]"
                        >
                          evidence
                        </a>
                      </>
                    ) : null}
                  </div>
                  {c.notes ? <p className="text-xs opacity-60 mb-3 whitespace-pre-wrap">{c.notes}</p> : null}
                  {c.sourceRefs.length > 0 ? (
                    <details className="text-xs opacity-80 mb-3">
                      <summary className="cursor-pointer opacity-60">
                        {c.sourceRefs.length} source{c.sourceRefs.length === 1 ? "" : "s"}
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {c.sourceRefs.map((s, i) => (
                          <li key={`${s.url}-${i}`}>
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[var(--accent)] break-all"
                            >
                              {s.title ?? prettifyUrl(s.url)}
                            </a>
                            {s.snippet ? <span className="opacity-60"> · {s.snippet}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {confirmCandidateId === c.id && confirmCandidateOrganizationId === org.id && confirmContactId && confirmExistingOrganizationId && confirmEmail ? (
                    <div className="mb-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-3 text-xs">
                      <div className="font-semibold text-[var(--accent)]">Email already belongs to another organization</div>
                      <div className="mt-1 opacity-80 break-all">
                        {confirmEmail} · contact {confirmContactId.slice(0, 8)}... · current org {confirmExistingOrganizationId.slice(0, 8)}...
                      </div>
                      <form className="mt-3 flex flex-wrap gap-2" action="/api/commands" method="post">
                        <input type="hidden" name="commandType" value="approve_contact_candidate" />
                        <input type="hidden" name="candidateId" value={c.id} />
                        <input type="hidden" name="email" value={confirmEmail} />
                        <input type="hidden" name="confirmReattach" value="true" />
                        <input
                          type="hidden"
                          name="idempotencyKey"
                          value={buildApproveContactCandidateIdempotencyKey(c.id, c.updatedAt)}
                        />
                        <button
                          type="submit"
                          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-bold text-black hover:opacity-90"
                        >
                          Confirm reattach
                        </button>
                      </form>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <form className="space-y-2" action="/api/commands" method="post">
                      <input type="hidden" name="commandType" value="approve_contact_candidate" />
                      <input type="hidden" name="candidateId" value={c.id} />
                      <input
                        name="email"
                        type="email"
                        placeholder="email (required if missing)"
                        defaultValue={c.email ?? ""}
                        className="w-full rounded-lg bg-[#1A1A1B] border border-white/10 p-2 text-xs"
                      />
                      <input
                        name="fullName"
                        placeholder="full name (optional)"
                        defaultValue={c.fullName ?? ""}
                        className="w-full rounded-lg bg-[#1A1A1B] border border-white/10 p-2 text-xs"
                      />
                      <input
                        name="roleTitle"
                        placeholder="role (optional)"
                        defaultValue={c.role ?? ""}
                        className="w-full rounded-lg bg-[#1A1A1B] border border-white/10 p-2 text-xs"
                      />
                      <button
                        type="submit"
                        className="w-full rounded-lg bg-[var(--accent)] text-black font-bold py-2 text-xs"
                      >
                        Approve
                      </button>
                    </form>
                    <form className="space-y-2" action="/api/commands" method="post">
                      <input type="hidden" name="commandType" value="reject_contact_candidate" />
                      <input type="hidden" name="candidateId" value={c.id} />
                      <select
                        name="reasonCode"
                        defaultValue="other"
                        className="w-full rounded-lg bg-[#1A1A1B] border border-white/10 p-2 text-xs"
                      >
                        {contactRejectionReasonCodes.map((code) => (
                          <option key={code} value={code}>
                            {CONTACT_REJECTION_REASON_LABELS[code]}
                          </option>
                        ))}
                      </select>
                      <textarea
                        name="reasonText"
                        placeholder="rejection notes (optional)"
                        rows={2}
                        className="w-full rounded-lg bg-[#1A1A1B] border border-white/10 p-2 text-xs"
                      />
                      <button
                        type="submit"
                        className="w-full rounded-lg bg-[#7f2d20] text-white font-bold py-2 text-xs"
                      >
                        Reject
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <BlockTitle title="Timeline" className="mb-4 text-left" />
          {org.timeline.length === 0 ? (
            <p className="text-sm font-light opacity-60">No events recorded.</p>
          ) : (
            <ul className="space-y-2">
              {org.timeline.map((e) => (
                <li key={e.id} className="border-b border-white/10 pb-2 last:border-b-0 text-sm">
                  <div className="flex justify-between gap-4">
                    <strong className="font-medium">{e.eventType}</strong>
                    <span className="text-xs opacity-60">
                      {new Date(e.createdAt).toISOString().slice(0, 19).replace("T", " ")}
                    </span>
                  </div>
                  <div className="text-xs opacity-60 mt-0.5">
                    {e.entityType ?? "—"}
                    {e.entityId ? ` · ${e.entityId.slice(0, 8)}…` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}

function StatCard({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <Card className="min-h-0 p-6">
      <div className={`text-3xl font-bold ${accent ? "text-[var(--accent)]" : ""}`}>{value}</div>
      <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-2">{label}</div>
    </Card>
  );
}

function SnapshotPanel({
  snapshot,
  orgName,
  orgId,
  orgDomain
}: {
  snapshot: NonNullable<Awaited<ReturnType<typeof getOrganizationDetail>>>["latestSnapshot"];
  orgName: string;
  orgId: string;
  orgDomain: string | null;
}) {
  return (
    <Card>
      <div className="flex justify-between items-start flex-wrap gap-4 mb-6">
        <div>
          <BlockTitle title="Research snapshot" className="mb-1 text-left" />
          {snapshot ? (
            <p className="text-sm opacity-70 font-light">
              v{snapshot.version} · {snapshot.status} ·{" "}
              {new Date(snapshot.createdAt).toISOString().slice(0, 19).replace("T", " ")} ·{" "}
              {snapshot.facts.length} fact{snapshot.facts.length === 1 ? "" : "s"}
            </p>
          ) : (
            <p className="text-sm opacity-70 font-light">No snapshot yet for this organisation.</p>
          )}
        </div>
        <form action="/api/commands" method="post" className="flex gap-2 items-start">
          <input type="hidden" name="commandType" value="refresh_research_snapshot" />
          <input type="hidden" name="organizationId" value={orgId} />
          <input
            type="hidden"
            name="prompt"
            value={`Research ${orgName}${orgDomain ? ` (${orgDomain})` : ""}: produce a structured snapshot with claims and confidence levels.`}
          />
          <button
            type="submit"
            className="rounded-lg bg-[hsl(var(--primary))] text-black font-bold px-4 py-2 text-sm hover:opacity-90"
          >
            {snapshot ? "Refresh snapshot" : "Run research"}
          </button>
        </form>
      </div>

      {snapshot && snapshot.facts.length === 0 ? (
        <p className="text-sm font-light opacity-60">Snapshot recorded but no facts yet — pipeline still running?</p>
      ) : null}

      {snapshot && snapshot.questions.length > 0 ? (
        <div className="border border-white/10 rounded-xl p-4 bg-black/20">
          <div className="text-xs uppercase tracking-[0.2em] opacity-60 mb-2">
            Open research questions
          </div>
          <ul className="list-disc pl-5 space-y-1 text-sm opacity-80">
            {snapshot.questions.map((question, i) => (
              <li key={`${question}-${i}`}>{question}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {snapshot && snapshot.facts.length > 0 ? (
        <ul className="space-y-4">
          {snapshot.facts.map((fact) => (
            <li key={fact.id} className="border border-white/10 rounded-xl p-5 bg-black/30">
              <div className="flex justify-between items-start gap-4 mb-3">
                <p className="text-base font-light leading-relaxed flex-1">{fact.factText}</p>
                <ConfidenceBadge value={fact.confidence} safe={fact.safeForCopy} status={fact.status} />
              </div>
              {fact.evidence.length > 0 ? (
                <ul className="space-y-2 mt-3 pt-3 border-t border-white/5">
                  {fact.evidence.map((e) => (
                    <li key={e.id} className="text-xs opacity-80">
                      <span className="inline-block px-2 py-0.5 rounded bg-white/5 mr-2 uppercase tracking-wider">
                        {e.supportType}
                      </span>
                      {e.sourceUrl ? (
                        <a
                          href={e.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--accent)] break-all"
                        >
                          {prettifyUrl(e.sourceUrl)}
                        </a>
                      ) : (
                        <span className="opacity-60">{e.sourceType}</span>
                      )}
                      {e.quoteText ? (
                        <p className="mt-1 italic opacity-70 pl-4 border-l border-white/10">“{e.quoteText}”</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function ConfidenceBadge({ value, safe, status }: { value: number; safe: boolean; status: string }) {
  const tone = value >= 80 ? "text-[var(--accent)] border-[var(--accent)]/40" : value >= 50 ? "text-[hsl(var(--primary))] border-[hsl(var(--primary))]/40" : "text-white/60 border-white/20";
  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <span className={`text-xs px-2 py-0.5 rounded-full border ${tone} whitespace-nowrap`}>
        conf {value}
      </span>
      <span className="text-[10px] opacity-60 uppercase tracking-wider">
        {status}
        {safe ? " · safe" : ""}
      </span>
    </div>
  );
}

function prettifyUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host + u.pathname.replace(/\/$/, "");
  } catch {
    return url;
  }
}

function confidenceLabel(score: number): string {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  if (score >= 10) return "low";
  return "unset";
}

function safeEvidenceHref(raw: string | null): string | null {
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : null;
}

function singleQueryParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
