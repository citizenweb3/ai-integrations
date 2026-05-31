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
import { Badge } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { AutoRefreshWhenActive } from "@/components/auto-refresh-when-active";
import {
  BackgroundActivityStrip,
  liveActivityTotal,
} from "@/components/background-activity-strip";

// T-026AH/B: split the org detail page into tabs (research / contacts /
// threads / timeline) so the operator sees one section at a time
// instead of scrolling past six unrelated cards. The page is still a
// server component; the active tab is read from `?tab=` so navigation
// is a plain Next link click (no client state).
type OrgTab = "research" | "contacts" | "threads" | "timeline";
const ORG_TAB_KEYS: OrgTab[] = ["research", "contacts", "threads", "timeline"];

function resolveOrgTab(raw: string | null): OrgTab {
  if (raw === "research" || raw === "contacts" || raw === "threads" || raw === "timeline") {
    return raw;
  }
  return "research";
}

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
  const activeTab = resolveOrgTab(singleQueryParam(query.tab));
  const pendingContactCandidates = org.pendingContactCandidates.length;

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
            {org.discoveryWebsiteUrl ?? org.domain ?? "no domain"}
            {org.discoveryRegion
              ? ` · ${org.discoveryRegion}`
              : org.countryCode
                ? ` · ${org.countryCode}`
                : ""}
          </>
        }
      />

      <section className="max-w-[88vw] mx-auto px-4 pb-24 space-y-8">
        <div className="flex items-center gap-3 text-sm">
          <BackLink fallbackHref="/organizations" label="← Back" />
          <span className="opacity-40">·</span>
          <span className="opacity-60">Organisation detail</span>
        </div>

        <BackgroundActivityStrip
          activity={{
            discoveryRunning: 0,
            researchInFlight: org.pipelineActivity.researchInFlight,
            contactDiscoveryInFlight: org.pipelineActivity.contactDiscoveryInFlight,
            draftingInFlight: org.pipelineActivity.draftingInFlight,
          }}
        />
        <AutoRefreshWhenActive
          active={
            liveActivityTotal({
              discoveryRunning: 0,
              researchInFlight: org.pipelineActivity.researchInFlight,
              contactDiscoveryInFlight: org.pipelineActivity.contactDiscoveryInFlight,
              draftingInFlight: org.pipelineActivity.draftingInFlight,
            }) > 0
          }
        />

        {org.discoveryFitRationale || org.discoveryWebsiteUrl ? (
          <Card>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <div className="text-xs font-semibold tracking-[0.2em] uppercase opacity-70">
                Why the agent picked this org
              </div>
              {org.discoveryWebsiteUrl ? (
                <a
                  href={org.discoveryWebsiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold tracking-[0.18em] uppercase text-[var(--accent)] hover:opacity-80"
                >
                  Open website ↗
                </a>
              ) : null}
            </div>
            {org.discoveryFitRationale ? (
              <p className="text-sm font-light opacity-90 leading-relaxed whitespace-pre-wrap">
                {org.discoveryFitRationale}
              </p>
            ) : (
              <p className="text-sm font-light opacity-60">
                Discovery left no rationale for this org. Open the candidate
                triage page to see the original source references.
              </p>
            )}
          </Card>
        ) : null}

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard
            label="Approved contacts"
            value={org.stats.contacts}
            hint="People you've approved as addressable. Drafts can target them directly."
          />
          <StatCard
            label="Threads"
            value={org.stats.threads}
            hint="Email conversations with this org. Increases when sends + replies land."
          />
          <StatCard
            label="Outreach"
            value={org.stats.outreachRecords}
            hint="Outreach attempts (drafts × send attempts). Counts every dispatch attempt, not unique recipients."
          />
          <StatCard
            label="Sent"
            value={org.stats.sentOutbound}
            hint="Messages Resend confirmed it sent on your behalf."
          />
          <StatCard
            label="Replies"
            value={org.stats.inboundReplies}
            hint="Inbound replies (any reply class) attached to a thread for this org."
          />
          <StatCard
            label="Open items"
            value={org.stats.openWorkItems}
            accent={org.stats.openWorkItems > 0}
            hint="Action items the system has flagged for you on this org (scope, drafts, replies needing attention)."
          />
        </div>

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
              <label className="block text-xs uppercase tracking-[0.18em] opacity-70 mt-2">
                Contact
              </label>
              {(() => {
                // T-026AZ: only contacts with an email are eligible
                // recipients — emailless rows hang inert until someone
                // fills the address in.
                const eligibleContacts = org.contacts.filter((c) => c.email !== null);
                if (eligibleContacts.length === 0) {
                  return (
                    <p className="text-xs font-light opacity-60">
                      No approved contacts with an email yet. The draft will go out without a
                      specific recipient attached — add an email to an approved contact in the
                      Contacts tab to target a person.
                    </p>
                  );
                }
                return (
                  <select
                    name="contactId"
                    defaultValue={
                      org.primaryContactId ??
                      (eligibleContacts.length === 1 ? eligibleContacts[0]!.id : "")
                    }
                    className="w-full rounded-lg bg-[#1A1A1B] border border-white/10 p-3 text-sm"
                  >
                    <option value="">No specific recipient (generic outreach)</option>
                    {eligibleContacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName ? `${c.fullName} · ` : ""}{c.email}
                        {c.isPrimary ? " · primary" : ""}
                      </option>
                    ))}
                  </select>
                );
              })()}
              <label className="block text-xs uppercase tracking-[0.18em] opacity-70 mt-2">
                Campaign
              </label>
              {org.sourceCampaigns.length === 0 ? (
                <p className="text-xs font-light opacity-60">
                  This org has no source campaign. The draft will be generated without the campaign
                  brief feeding the agent.
                </p>
              ) : (
                <select
                  name="campaignId"
                  defaultValue={org.sourceCampaigns.length === 1 ? org.sourceCampaigns[0]!.id : ""}
                  className="w-full rounded-lg bg-[#1A1A1B] border border-white/10 p-3 text-sm"
                >
                  {org.sourceCampaigns.length > 1 ? (
                    <option value="">Pick one</option>
                  ) : null}
                  {org.sourceCampaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
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

        <OrgTabsNav
          activeTab={activeTab}
          orgId={org.id}
          counts={{
            contacts: org.contacts.length,
            pendingContactCandidates,
            threads: org.threads.length,
            timelineEntries: org.timeline.length
          }}
        />

        {activeTab === "research" ? (
          <SnapshotPanel
            snapshot={org.latestSnapshot}
            orgName={org.name}
            orgId={org.id}
            orgDomain={org.domain}
          />
        ) : null}

        {activeTab === "threads" ? (
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
        ) : null}

        {activeTab === "contacts" ? (
        <>
        <Card>
          <BlockTitle title="Approved contacts" className="mb-2 text-left" />
          {org.contacts.length === 0 ? (
            <p className="text-sm font-light opacity-60">
              No approved contacts yet. Approve a candidate from the queue below to add one — once
              approved, the contact becomes addressable for drafts.
            </p>
          ) : (() => {
            const withEmail = org.contacts.filter((c) => c.email !== null);
            const withoutEmail = org.contacts.filter((c) => c.email === null);
            return (
              <div className="space-y-6">
                {/* SENDABLE GROUP — contacts that drafts can target as-is. */}
                <section>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold tracking-[0.18em] uppercase text-[var(--accent)]">
                      Ready to receive ({withEmail.length})
                    </span>
                    <span className="flex-1 h-px bg-[var(--accent)]/20" />
                  </div>
                  <p className="text-xs font-light opacity-65 leading-snug mb-3">
                    These contacts have an email address attached. They are eligible
                    recipients in the Generate AI draft form — pick one and the draft
                    will land in their inbox once you approve it.
                  </p>
                  {withEmail.length === 0 ? (
                    <p className="text-sm font-light opacity-60 italic">
                      None yet. Either approve a candidate with an email or add an email
                      to one of the contacts below.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {withEmail.map((c) => (
                        <li
                          key={c.id}
                          className="flex flex-wrap justify-between items-start gap-4 border-b border-white/10 pb-2 last:border-b-0 text-sm"
                        >
                          <div className="min-w-0 flex-1">
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
                                value={buildSetPrimaryContactIdempotencyKey(
                                  org.id,
                                  c.id,
                                  org.updatedAt
                                )}
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
                </section>

                {/* INERT GROUP — approved by the operator but no address yet. */}
                {withoutEmail.length > 0 ? (
                  <section>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold tracking-[0.18em] uppercase text-yellow-400">
                        Waiting on an email ({withoutEmail.length})
                      </span>
                      <span className="flex-1 h-px bg-yellow-500/20" />
                    </div>
                    <p className="text-xs font-light opacity-65 leading-snug mb-3">
                      These contacts are approved but no email address was found yet.
                      Drafts and sends skip them — they will move to the
                      &ldquo;Ready to receive&rdquo; group above the moment you add
                      an address. Leaving them empty is fine; they will just stay
                      here doing nothing.
                    </p>
                    <ul className="space-y-2">
                      {withoutEmail.map((c) => (
                        <li
                          key={c.id}
                          className="flex flex-wrap justify-between items-start gap-4 rounded-lg border border-yellow-500/20 bg-yellow-500/[0.04] p-3 text-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">
                              {c.fullName ?? "(no name)"}
                              <span className="ml-2 rounded-full border border-yellow-500/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-yellow-400">
                                no email
                              </span>
                            </div>
                            {c.roleTitle ? (
                              <div className="opacity-60">{c.roleTitle}</div>
                            ) : null}
                            <form
                              action="/api/commands"
                              method="post"
                              className="mt-2 flex flex-wrap gap-2"
                            >
                              <input type="hidden" name="commandType" value="set_contact_email" />
                              <input type="hidden" name="contactId" value={c.id} />
                              <input
                                name="email"
                                type="email"
                                placeholder="paste email here once you find it"
                                className="flex-1 min-w-[200px] rounded-lg bg-[#1A1A1B] border border-white/10 p-1.5 text-xs"
                              />
                              <button
                                type="submit"
                                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-black hover:opacity-90"
                              >
                                Add email
                              </button>
                            </form>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            );
          })()}
        </Card>

        <Card>
          <BlockTitle title="Pending contact candidates" className="mb-4 text-left" />
          <p className="text-sm font-light opacity-70 mb-2">
            Operator review queue from research_snapshot stage. The agent surfaces candidates with
            and without an email; the queue below holds the ones that need your decision.
          </p>
          <p className="text-xs font-light opacity-60 mb-4 border-l-2 border-[var(--accent)]/40 pl-3">
            <strong className="text-[var(--accent)]">Heads up:</strong> candidates the agent
            surfaced with a verbatim email are auto-approved into the Approved contacts list above
            the moment contact discovery completes — you do not need to click Approve for them. The
            queue below holds only the ones that still need a decision: a manual email entry, a
            rejection, or a cross-org email reattach.
          </p>
          {(() => {
            if (org.pendingContactCandidates.length === 0) {
              return <p className="text-sm font-light opacity-60">No pending candidates.</p>;
            }
            const hasEmail = (c: PendingCandidate): boolean =>
              c.email !== null && c.email !== "";
            const isGeneric = (c: PendingCandidate): boolean => c.source === "generic_inbox";
            const specificWithEmail = org.pendingContactCandidates.filter(
              (c) => hasEmail(c) && !isGeneric(c)
            );
            const generic = org.pendingContactCandidates.filter(isGeneric);
            const noEmail = org.pendingContactCandidates.filter(
              (c) => !hasEmail(c) && !isGeneric(c)
            );
            const confirms = {
              confirmCandidateId,
              confirmCandidateOrganizationId,
              confirmContactId,
              confirmExistingOrganizationId,
              confirmEmail
            };
            return (
              <div className="space-y-8">
                <PendingCandidateGroup
                  title="Addressable specific people"
                  subtitle="Specific person with a verbatim email found on a public source. Approve to convert into a contact and unlock drafting."
                  tone="accent"
                  candidates={specificWithEmail}
                  org={org}
                  confirms={confirms}
                />
                <PendingCandidateGroup
                  title="Generic company inbox"
                  subtitle="Company-wide inbox (info@, sales@, partners@, …) surfaced verbatim from the org's public page. Approve to use it as a fallback addressable contact when no specific person is available."
                  tone="accent"
                  candidates={generic}
                  org={org}
                  confirms={confirms}
                />
                <PendingCandidateGroup
                  title="No email"
                  subtitle={
                    "Specific person but the agent could not find an email on the public source. Supply one manually before Approve, " +
                    "reject (Low confidence / Private PII fit), or leave pending — they do not progress on their own."
                  }
                  tone="warning"
                  candidates={noEmail}
                  org={org}
                  confirms={confirms}
                />
              </div>
            );
          })()}
        </Card>
        </>
        ) : null}

        {activeTab === "timeline" ? (
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
        ) : null}
      </section>
    </>
  );
}

// T-026AH fixup: split pending contact candidates into "Addressable"
// (has email) and "No email" sub-groups so the operator can see at a
// glance which candidates are ready to approve and which need manual
// email entry before they can move forward.
type PendingCandidate = NonNullable<
  Awaited<ReturnType<typeof getOrganizationDetail>>
>["pendingContactCandidates"][number];

type PendingCandidateConfirms = {
  confirmCandidateId: string | null;
  confirmCandidateOrganizationId: string | null;
  confirmContactId: string | null;
  confirmExistingOrganizationId: string | null;
  confirmEmail: string | null;
};

function PendingCandidateGroup({
  title,
  subtitle,
  tone,
  candidates,
  org,
  confirms
}: {
  title: string;
  subtitle: string;
  tone: "accent" | "warning";
  candidates: PendingCandidate[];
  org: { id: string; updatedAt: Date };
  confirms: PendingCandidateConfirms;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold tracking-[0.18em] uppercase opacity-90">{title}</h3>
        <Badge tone={tone}>{candidates.length}</Badge>
      </div>
      <p className="text-xs font-light opacity-60 max-w-2xl">{subtitle}</p>
      {candidates.length === 0 ? (
        <p className="text-sm font-light opacity-50">None.</p>
      ) : (
        <ul className="space-y-4">
          {candidates.map((c) => (
            <PendingCandidateRow key={c.id} candidate={c} org={org} confirms={confirms} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PendingCandidateRow({
  candidate: c,
  org,
  confirms
}: {
  candidate: PendingCandidate;
  org: { id: string; updatedAt: Date };
  confirms: PendingCandidateConfirms;
}) {
  const { confirmCandidateId, confirmCandidateOrganizationId, confirmContactId, confirmExistingOrganizationId, confirmEmail } = confirms;
  return (
    <li className="border border-white/10 rounded-xl p-4">
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
  );
}

// T-026AH/B: tab bar for the org detail page. Renders as Next links so
// switching tabs is a normal navigation, which re-runs the server
// component and re-fetches the org detail in one round trip. Active
// state is passed in by the page; the page derives it from `?tab=`.
function OrgTabsNav({
  activeTab,
  orgId,
  counts
}: {
  activeTab: OrgTab;
  orgId: string;
  counts: {
    contacts: number;
    pendingContactCandidates: number;
    threads: number;
    timelineEntries: number;
  };
}) {
  const items: Array<{ key: OrgTab; label: string; badge?: number; highlight?: boolean }> = [
    { key: "research", label: "Research" },
    {
      key: "contacts",
      label: "Contacts",
      badge: counts.contacts + counts.pendingContactCandidates,
      highlight: counts.pendingContactCandidates > 0
    },
    { key: "threads", label: "Threads", badge: counts.threads },
    { key: "timeline", label: "Timeline", badge: counts.timelineEntries }
  ];
  return (
    <nav className="flex flex-wrap gap-2 border-b border-white/10 pb-2">
      {items.map((item) => {
        const isActive = item.key === activeTab;
        const href =
          item.key === "research"
            ? `/organizations/${orgId}`
            : `/organizations/${orgId}?tab=${item.key}`;
        return (
          <Link
            key={item.key}
            href={href}
            scroll={false}
            className={
              "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors hover:no-underline " +
              (isActive
                ? "bg-white/10 text-white font-semibold"
                : "text-white/70 hover:bg-white/5")
            }
          >
            {item.label}
            {typeof item.badge === "number" && item.badge > 0 ? (
              <Badge tone={item.highlight ? "warning" : "default"}>{item.badge}</Badge>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

// Suppress unused-import warning if a future cleanup removes ORG_TAB_KEYS.
void ORG_TAB_KEYS;

function StatCard({
  label,
  value,
  accent = false,
  hint
}: {
  label: string;
  value: number;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <Card className="min-h-0 p-6">
      <div className={`text-3xl font-bold ${accent ? "text-[var(--accent)]" : ""}`}>{value}</div>
      <div className="text-xs uppercase tracking-[0.2em] opacity-60 mt-2">{label}</div>
      {hint ? (
        <div className="text-[11px] font-light opacity-50 leading-snug mt-2">{hint}</div>
      ) : null}
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
              <span title="Snapshot version. Bumps every time the snapshot is refreshed.">
                research v{snapshot.version}
              </span>{" · "}
              {new Date(snapshot.createdAt).toISOString().slice(0, 19).replace("T", " ")}{" · "}
              <span title="Number of distinct facts the agent extracted into this snapshot.">
                {snapshot.facts.length} fact{snapshot.facts.length === 1 ? "" : "s"}
              </span>
            </p>
          ) : (
            <p className="text-sm opacity-70 font-light">
              No research snapshot yet for this organisation. Drafts cannot use it until the
              snapshot job lands.
            </p>
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
  const tier = value >= 80 ? "high" : value >= 50 ? "medium" : "low";
  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <span
        className={`text-xs px-2 py-0.5 rounded-full border ${tone} whitespace-nowrap`}
        title={`Agent confidence in this fact: ${tier} (${value} / 100). High ≥ 80, medium ≥ 50, low otherwise.`}
      >
        {tier} confidence
      </span>
      <span
        className="text-[10px] opacity-60 uppercase tracking-wider"
        title="Draft = needs operator review. Approved = signed off. `safe` = the agent marked this fact as safe to paraphrase verbatim in a cold email."
      >
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
