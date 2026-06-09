import {
  evaluatePreSendGuardrails,
  getDraftDetail,
  getDraftFeedback,
  getDraftVersionHistory,
  getResearchContextForDraft
} from "@bizdev/db";
import {
  evaluateTimingAdvice,
  nonOverridableGuardrailCodes,
  overridableGuardrailCodes
} from "@bizdev/shared";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import { BackLink } from "@/components/back-link";
import { Badge, Button, InfoRow, MetricCard, PageBody, inputClass, textareaClass } from "@/components/ui";
import { SideDrawer } from "@/components/side-drawer";
import { DraftModifyDrawers } from "@/components/draft-modify-drawers";
import { SnapshotFreshness, SnapshotStaleWarning } from "@/components/snapshot-freshness";

export const dynamic = "force-dynamic";

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function bandTone(band: string | null): "accent" | "warning" | "danger" | "default" {
  if (band === "high") return "accent";
  if (band === "medium") return "warning";
  if (band === "low") return "danger";
  return "default";
}

function readinessColor(readiness: string | null): string {
  if (readiness === "promising") return "text-emerald-400";
  if (readiness === "low_confidence") return "text-yellow-400";
  if (readiness?.startsWith("blocked_")) return "text-red-400";
  return "opacity-70";
}

function sourceTone(source: string): "primary" | "warning" | "accent" | "default" {
  if (source === "agent_generated" || source === "agent_revised") return "primary";
  if (source === "operator_edited") return "warning";
  if (source === "legacy_unknown") return "default";
  return "accent";
}

function severityClass(sev: string | null): string {
  if (sev === "rewrite" || sev === "major") return "text-red-400";
  if (sev === "moderate") return "text-yellow-400";
  if (sev === "minor") return "text-emerald-400";
  return "opacity-70";
}

function corpusClass(label: string | null): string {
  if (label === "positive") return "text-emerald-400";
  if (label === "negative") return "text-red-400";
  return "opacity-70";
}

// Collapsible group. Native <details>/<summary> — server-rendered,
// no client JS, keyboard-accessible. Used for context and modify
// blocks so an operator who just wants to approve a healthy draft
// sees a short page; an operator who needs to dig has the same
// information one click away.
function Collapsible({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden"
    >
      <summary className="flex items-baseline justify-between gap-3 px-5 py-3 cursor-pointer list-none select-none hover:bg-white/[0.04] transition-colors">
        <span className="text-sm font-semibold tracking-[0.05em]">{title}</span>
        <span className="text-[10px] uppercase tracking-[0.2em] opacity-50 group-open:hidden">
          show
        </span>
        <span className="text-[10px] uppercase tracking-[0.2em] opacity-50 hidden group-open:inline">
          hide
        </span>
      </summary>
      <div className="px-5 pb-5 pt-2 space-y-3">
        {hint ? <p className="text-xs font-light opacity-60 leading-snug">{hint}</p> : null}
        {children}
      </div>
    </details>
  );
}

function GroupHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="space-y-1 mt-6">
      <div className="text-xs font-semibold tracking-[0.2em] uppercase opacity-70">{title}</div>
      <p className="text-xs font-light opacity-55 leading-snug max-w-3xl">{hint}</p>
    </div>
  );
}

type Props = { params: Promise<{ id: string }> };

export default async function DraftDetailPage({ params }: Props) {
  const { id } = await params;
  const draft = await getDraftDetail(id);
  if (!draft) {
    notFound();
  }
  const versionHistory = await getDraftVersionHistory(id);
  const researchContext = await getResearchContextForDraft(id);
  const feedbackRows = await getDraftFeedback(id);

  const editable = draft.status === "draft";
  const recipientEmail = draft.contact?.email ?? null;
  const draftOrgId = draft.contact?.organizationId ?? draft.thread?.organizationId ?? null;
  const needsReviewClaims = draft.claims.filter((c) => c.safety === "needs_review");
  const claimsStale = editable && draft.claimsValidatedVersion !== draft.version;
  const guardrails = editable && recipientEmail
    ? await evaluatePreSendGuardrails({
        draftId: draft.id,
        recipientEmail,
        ...(draft.threadId ? { threadId: draft.threadId } : {}),
        ...(draft.contactId ? { contactId: draft.contactId } : {})
      })
    : { failures: [] };
  const sendable = editable && Boolean(recipientEmail) && guardrails.failures.length === 0;

  const hardFailureSet = new Set<string>(nonOverridableGuardrailCodes);
  const softFailureSet = new Set<string>(overridableGuardrailCodes);
  const hardFailures = guardrails.failures.filter((f) => hardFailureSet.has(f.code));
  const softFailures = guardrails.failures.filter((f) => softFailureSet.has(f.code));
  const overrideAvailable =
    editable &&
    Boolean(recipientEmail) &&
    Boolean(draft.contact) &&
    hardFailures.length === 0 &&
    softFailures.length > 0;

  const timingAdvice = editable
    ? evaluateTimingAdvice({
        draftKind: draft.kind === "warm" ? "warm" : "cold",
        recipientEmail: recipientEmail ?? null
      })
    : null;

  const supportedCount = draft.claims.filter((c) => c.safety === "supported").length;
  const needsReviewCount = needsReviewClaims.length;

  return (
    <>
      <ConsoleHero currentNav="drafts"
        eyebrow={
          <>
            <Link href="/drafts" className="text-[hsl(var(--primary))]">
              Drafts
            </Link>{" "}
            / Draft
          </>
        }
        title={draft.subject}
        subtitle={`v${draft.version} · ${draft.status}`}
      />

      <PageBody>
        <div className="flex items-center gap-3 text-sm">
          <BackLink fallbackHref="/drafts" label="← Back" />
          <span className="opacity-40">·</span>
          <span className="opacity-60">Draft detail</span>
        </div>

        {/* META TILES — at-a-glance facts about the draft. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Status" value={draft.status} />
          <MetricCard label="Version" value={`v${draft.version}`} accent />
          <div className="rounded-2xl bg-white/5 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
            <div className="text-xs uppercase tracking-[0.2em] opacity-60 mb-2">Contact</div>
            {draft.contact ? (
              <>
                <div className="text-sm font-medium break-all">{draft.contact.email ?? "no email"}</div>
                <div className="text-xs opacity-60 mt-1">{draft.contact.fullName ?? "—"}</div>
                {draft.contact.organizationId ? (
                  <Link
                    href={`/organizations/${draft.contact.organizationId}`}
                    className="text-xs hover:text-[var(--accent)]"
                  >
                    org
                  </Link>
                ) : null}
                {/* T-026BI: change the contact email without leaving the
                    draft. Auto-drafts may land with a wrong/empty email;
                    set_contact_email updates the contact, which the draft
                    picks up via contact_id. */}
                {editable && draft.contactId ? (
                  <details className="mt-2">
                    <summary className="text-xs opacity-60 cursor-pointer hover:opacity-100">
                      Change email
                    </summary>
                    <form action="/api/commands" method="post" className="mt-2 space-y-2">
                      <input type="hidden" name="commandType" value="set_contact_email" />
                      <input type="hidden" name="contactId" value={draft.contactId} />
                      <input
                        className={inputClass}
                        name="email"
                        type="email"
                        defaultValue={draft.contact.email ?? ""}
                        placeholder="new@email.com"
                        required
                      />
                      <Button type="submit" tone="ghost" size="sm">
                        Save email
                      </Button>
                    </form>
                  </details>
                ) : null}
              </>
            ) : (
              <p className="text-sm font-light opacity-60">No contact linked.</p>
            )}
          </div>
          <div className="rounded-2xl bg-white/5 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
            <div className="text-xs uppercase tracking-[0.2em] opacity-60 mb-2">Thread</div>
            {draft.thread ? (
              <Link
                href={`/threads/${draft.thread.id}`}
                className="text-xs font-mono break-all hover:text-[var(--accent)]"
              >
                {draft.thread.id}
              </Link>
            ) : (
              <p className="text-sm font-light opacity-60">No thread.</p>
            )}
          </div>
        </div>

        {/* OUTBOUND — only when an outbound row exists (post-send). */}
        {draft.outboundMessage ? (
          <Card>
            <BlockTitle title="Outbound" className="mb-4 text-left" />
            <InfoRow label="Status" value={<Badge>{draft.outboundMessage.status}</Badge>} />
            <InfoRow label="Recipient" value={draft.outboundMessage.recipientEmail} />
            <InfoRow label="Sent at" value={draft.outboundMessage.createdAt.toISOString()} />
          </Card>
        ) : null}

        {/* HARD-FAILURE BANNER — only when claims are stale (always must surface). */}
        {claimsStale ? (
          <Card className="border-l-4 border-l-red-500 bg-red-500/5">
            <BlockTitle title="Claims are stale" className="mb-3 text-left text-red-400" />
            <p className="text-sm font-light opacity-80">
              Draft is at v{draft.version}; claim safety last validated for v
              {draft.claimsValidatedVersion ?? "—"}. The body changed after the last validation —
              the claim list below describes a prior version. Approve & send is hard-blocked until
              revalidation finishes (worker job{" "}
              <code className="font-mono text-xs">job.revalidate_draft_claims</code>) or until the
              operator triggers AI revise.
            </p>
          </Card>
        ) : null}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* GROUP 1 — EMAIL PREVIEW. Read-only, always visible at the top. */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <GroupHeader
          title="Email preview"
          hint="This is exactly what the recipient will see when the draft is approved and sent."
        />
        <Card>
          <BlockTitle title="Body" className="mb-4 text-left" />
          <pre className="m-0 p-3 bg-black/40 rounded-lg text-xs whitespace-pre-wrap break-words font-mono max-h-[500px] overflow-auto">
            {draft.body}
          </pre>
        </Card>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* GROUP 2 — SEND DECISION. Quality + claims + guardrails + action. */}
        {/* This is the operator's focal point: "can I approve, or do I    */}
        {/* need to fix something first?"                                   */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <GroupHeader
          title="Send decision"
          hint="Combined quality signal + claim-safety summary + guardrail check. The action button at the bottom is the operator's next move."
        />

        <Card>
          <BlockTitle title="Quality &amp; readiness" className="mb-3 text-left" />
          {draft.qualityScore === null ? (
            <p className="text-sm font-light opacity-60">
              Not computed yet. Edit the draft, record feedback, or click recompute.
            </p>
          ) : (
            <div className="space-y-1">
              <InfoRow
                label="Quality score"
                value={
                  <Badge tone={bandTone(draft.qualityScoreBand)}>
                    <span title="Agent-assigned quality score (0–100). Bands: 0–39 weak, 40–69 okay, 70+ strong.">
                      {draft.qualityScore}/100 · {draft.qualityScoreBand}
                    </span>
                  </Badge>
                }
              />
              <InfoRow
                label="Send readiness"
                value={
                  <span
                    className={`font-semibold ${readinessColor(draft.autosendReadiness)}`}
                    title="Verdict on whether the draft can be auto-sent without human review."
                  >
                    {draft.autosendReadiness ?? "—"}
                  </span>
                }
              />
              {/* Plain-language why: the readiness label is derived from the
                  quality score + claim safety, not a separate judgement. The
                  bands trip operators ("why low_confidence when it looks
                  fine?"), so spell out the thresholds inline. */}
              {draft.autosendReadiness === "low_confidence" || draft.autosendReadiness === "promising" ? (
                <p className="text-xs font-light opacity-55 leading-snug text-right">
                  Score {draft.qualityScore}/100 — needs ≥75 for{" "}
                  <span className="text-emerald-400">promising</span>, ≥55 is{" "}
                  <span className="text-yellow-400">low_confidence</span>. Not a blocker; it
                  just means review before sending. See Reasons below for what moved the score.
                </p>
              ) : null}
              {draft.qualityScoreReasons.length > 0 ? (
                <InfoRow
                  label="Reasons"
                  value={
                    <div className="flex flex-wrap gap-1 justify-end">
                      {draft.qualityScoreReasons.map((r) => (
                        <code key={r} className="font-mono text-[11px] opacity-70">
                          {r}
                        </code>
                      ))}
                    </div>
                  }
                />
              ) : null}
              {draft.scoresComputedAt ? (
                <InfoRow label="Computed at" value={draft.scoresComputedAt.toISOString()} />
              ) : null}
              <InfoRow
                label="Claim safety"
                value={
                  <span className="text-sm font-light">
                    <strong className="text-emerald-400">{supportedCount}</strong> supported ·{" "}
                    <strong className={needsReviewCount > 0 ? "text-red-400" : "opacity-70"}>
                      {needsReviewCount}
                    </strong>{" "}
                    needs review · {draft.claims.length} total
                  </span>
                }
              />
              {editable && recipientEmail ? (
                <InfoRow
                  label="Pre-send guardrails"
                  value={
                    guardrails.failures.length === 0 ? (
                      <span className="text-emerald-400 font-medium">All checks pass</span>
                    ) : (
                      <span className="font-semibold">
                        <span className={hardFailures.length > 0 ? "text-red-400" : "text-yellow-400"}>
                          {guardrails.failures.length} failing
                        </span>{" "}
                        <span className="text-xs opacity-60">
                          ({hardFailures.length} hard, {softFailures.length} soft)
                        </span>
                      </span>
                    )
                  }
                />
              ) : null}
            </div>
          )}
          <form action="/api/commands" method="post" className="mt-4">
            <input type="hidden" name="commandType" value="recompute_quality_score" />
            <input type="hidden" name="draftId" value={draft.id} />
            <Button type="submit" tone="ghost" size="sm">
              Recompute
            </Button>
          </form>
        </Card>

        {/* GUARDRAIL DETAILS — only when there are failures the operator must see. */}
        {editable && recipientEmail && guardrails.failures.length > 0 ? (
          <Card>
            <BlockTitle title="What is blocking send" className="mb-3 text-left" />
            <p className="text-xs opacity-60 mb-3">
              Each failing check below is either non-overridable (must be cleared at the source)
              or overridable (operator may force-send with an audited reason).
            </p>
            <ul className="space-y-2">
              {guardrails.failures.map((f, idx) => {
                const isHard = hardFailureSet.has(f.code);
                return (
                  <li key={idx} className="border border-white/10 rounded-xl p-3 bg-black/30 space-y-1">
                    <div className="flex gap-2 items-baseline">
                      <strong className="text-red-400">{f.code}</strong>
                      <Badge tone={isHard ? "danger" : "warning"}>
                        {isHard ? "non-overridable" : "overridable"}
                      </Badge>
                    </div>
                    <div className="text-xs opacity-70">{f.message}</div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}

        {/* PRIMARY ACTION — the one button the operator came here to use. */}
        {sendable && draft.contact ? (
          <Card className="border-l-4 border-l-emerald-500 bg-emerald-500/5">
            <BlockTitle title="Approve &amp; send" className="mb-3 text-left text-emerald-400" />
            <p className="text-sm font-light opacity-80 mb-3">
              All checks pass. Approves draft v{draft.version} and enqueues outbound send via Resend.
              The recipient at <strong>{draft.contact.email}</strong> will receive the email above.
            </p>
            <form action="/api/commands" method="post" className="space-y-3">
              <input type="hidden" name="commandType" value="approve_draft_for_send" />
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="draftVersion" value={String(draft.version)} />
              <Button type="submit">Approve and send</Button>
            </form>
          </Card>
        ) : overrideAvailable && draft.contact ? (
          <Card className="border-l-4 border-l-yellow-500 bg-yellow-500/5">
            <BlockTitle title="Force-send override" className="mb-3 text-left text-yellow-400" />
            <p className="text-sm font-light opacity-80 mb-3">
              All failing checks are overridable. To proceed, acknowledge EVERY code below by
              ticking it and supply a reason (10..2000 chars). Override is audited (
              <code className="font-mono text-xs">pre_send_override_applied</code> event); partial
              acknowledgement is rejected.
            </p>
            <form action="/api/commands" method="post" className="space-y-3">
              <input type="hidden" name="commandType" value="approve_draft_for_send" />
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="draftVersion" value={String(draft.version)} />
              <fieldset className="border border-white/15 rounded-lg p-3">
                <legend className="text-xs opacity-60 px-2">Acknowledge each blocker</legend>
                {[...new Set(softFailures.map((f) => f.code))].map((code) => (
                  <label key={code} className="flex gap-2 items-center py-1">
                    <input type="checkbox" name="acknowledgedCodes" value={code} required />
                    <code className="font-mono text-xs">{code}</code>
                  </label>
                ))}
              </fieldset>
              <textarea
                className={textareaClass}
                name="overrideReason"
                placeholder="Reason for overriding (10..2000 chars). Captured in audit log."
                rows={3}
                minLength={10}
                maxLength={2000}
                required
              />
              <Button type="submit" tone="danger">
                Override and send
              </Button>
            </form>
          </Card>
        ) : editable ? (
          <Card className="border-l-4 border-l-red-500 bg-red-500/5">
            <BlockTitle title="Send blocked" className="mb-3 text-left text-red-400" />
            <p className="text-sm font-light opacity-80">
              {!recipientEmail
                ? "Link a contact (with email) to enable send."
                : hardFailures.length > 0
                  ? "Non-overridable blocker(s) above must be cleared at the source — no operator bypass."
                  : "Resolve the guardrail blocker(s) above before approval."}
            </p>
          </Card>
        ) : null}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* GROUP 3 — CONTEXT. Collapsed by default. Information the       */}
        {/* operator may want to inspect but does not need to act on.       */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <GroupHeader
          title="Context"
          hint="Optional reading. Open a section to see how the draft was built and what state it carries."
        />

        <Collapsible
          title={
            <>
              Research used by the agent
              {researchContext?.snapshot ? (
                <>
                  {" · "}snapshot v{researchContext.snapshot.version}
                  {" · "}
                  <SnapshotFreshness createdAt={researchContext.snapshot.createdAt} />
                </>
              ) : null}
            </>
          }
          hint="Facts from research_snapshot the agent had available + which ones it actually cited in the body."
        >
          {!researchContext ? (
            <p className="text-sm font-light opacity-60">
              Draft has no resolvable organization (no linked contact or thread with org). The
              drafting agent had no research_snapshot to ground claims on.
            </p>
          ) : !researchContext.snapshot ? (
            <>
              <p className="text-sm font-light opacity-80">
                <strong>{researchContext.organization.name}</strong>
                {researchContext.organization.domain
                  ? ` · ${researchContext.organization.domain}`
                  : ""}
              </p>
              <p className="text-sm font-light opacity-60">
                No research snapshot for this organization. Approve & send is hard-blocked by{" "}
                <code className="font-mono text-xs">claims_stale</code> until a snapshot lands.
                Trigger “Investigate flagged claims” under Modify, or refresh research on the org page.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-light opacity-80">
                <strong>{researchContext.organization.name}</strong>
                {researchContext.organization.domain
                  ? ` · ${researchContext.organization.domain}`
                  : ""}{" "}
                · snapshot v{researchContext.snapshot.version} ·{" "}
                {researchContext.snapshot.status === "published" ? (
                  <span
                    className="text-emerald-400 font-medium"
                    title="Passed the research quality gate — enough verified facts to ground a draft."
                  >
                    ✓ verified
                  </span>
                ) : (
                  <span
                    className="opacity-60"
                    title="Not yet passed the quality gate (still enriching, or flagged as too thin)."
                  >
                    unverified
                  </span>
                )}{" · "}
                {researchContext.snapshot.createdAt.toISOString()}
              </p>
              <SnapshotStaleWarning
                createdAt={researchContext.snapshot.createdAt}
                orgId={researchContext.organization.id}
              />
              {researchContext.facts.length === 0 ? (
                <p className="text-sm font-light opacity-60">
                  Snapshot has no active facts. Try “Investigate flagged claims” under Modify.
                </p>
              ) : (
                <>
                  <p className="text-xs opacity-60">
                    {researchContext.facts.filter((f) => f.cited).length} cited ·{" "}
                    {researchContext.facts.filter((f) => !f.cited).length} available ·{" "}
                    {researchContext.facts.length} active facts
                  </p>
                  <ul className="space-y-3">
                    {researchContext.facts.map((fact) => (
                      <li
                        key={fact.id}
                        className="border border-white/10 rounded-xl p-3 bg-black/30 space-y-2"
                      >
                        <div className="flex justify-between gap-3">
                          <span className="text-sm">{fact.factText}</span>
                          <Badge tone={fact.cited ? "accent" : "default"}>
                            {fact.cited ? "cited" : "unused"} · conf {fact.confidence}
                          </Badge>
                        </div>
                        {fact.evidence.length > 0 ? (
                          <ul className="ml-3 space-y-1">
                            {fact.evidence.map((ev) => {
                              const safeUrl = safeHttpUrl(ev.sourceUrl);
                              return (
                                <li key={ev.id} className="text-xs opacity-80 space-y-1">
                                  <div className="break-all">
                                    {safeUrl ? (
                                      <a
                                        href={safeUrl}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        className="hover:text-[var(--accent)]"
                                      >
                                        {safeUrl}
                                      </a>
                                    ) : (
                                      <em>{ev.sourceType}</em>
                                    )}
                                    {" · "}
                                    {ev.supportType}
                                  </div>
                                  {ev.quoteText ? (
                                    <div className="italic opacity-70">
                                      &ldquo;{ev.quoteText}&rdquo;
                                    </div>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <span className="text-xs opacity-60">No evidence rows.</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </Collapsible>

        <Collapsible
          title={`Claim breakdown · ${supportedCount} supported / ${needsReviewCount} needs review`}
          hint="Per-claim view of what the body says and what backs it. Resolve unresolved claims manually if the operator wants to override the validator without changing the body."
          defaultOpen={needsReviewCount > 0}
        >
          {draft.claims.length === 0 ? (
            <p className="text-sm font-light opacity-60">No claims recorded for this draft.</p>
          ) : (
            <ul className="space-y-3">
              {draft.claims.map((claim) => {
                const isSupported = claim.safety === "supported";
                const isDropped = claim.safety === "dropped";
                return (
                  <li
                    key={claim.id}
                    className="border border-white/10 rounded-xl p-3 bg-black/30 space-y-2"
                  >
                    <div className="flex justify-between gap-3">
                      <strong className="text-sm font-medium">{claim.claimText}</strong>
                      <Badge tone={isSupported ? "accent" : isDropped ? "default" : "danger"}>
                        {claim.safety}
                      </Badge>
                    </div>
                    {claim.facts.length === 0 ? (
                      <span
                        className={`text-xs ${
                          isSupported ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        No backing facts cited.
                      </span>
                    ) : (
                      <ul className="ml-3 space-y-2">
                        {claim.facts.map((fact) => (
                          <li key={fact.factId} className="space-y-1">
                            <div className="flex justify-between gap-3 text-sm">
                              <span>{fact.factText}</span>
                              <span className="text-xs opacity-60 whitespace-nowrap">
                                v{fact.snapshotVersion} · conf {fact.confidence} · {fact.supportType}
                              </span>
                            </div>
                            {fact.evidence.length > 0 ? (
                              <ul className="ml-3 space-y-1">
                                {fact.evidence.map((ev) => {
                                  const safeUrl = safeHttpUrl(ev.sourceUrl);
                                  return (
                                    <li key={ev.id} className="text-xs opacity-80 space-y-1">
                                      <div className="break-all">
                                        {safeUrl ? (
                                          <a
                                            href={safeUrl}
                                            target="_blank"
                                            rel="noreferrer noopener"
                                            className="hover:text-[var(--accent)]"
                                          >
                                            {safeUrl}
                                          </a>
                                        ) : (
                                          <em>{ev.sourceType}</em>
                                        )}
                                        {" · "}
                                        {ev.supportType}
                                      </div>
                                      {ev.quoteText ? (
                                        <div className="italic opacity-70">
                                          &ldquo;{ev.quoteText}&rdquo;
                                        </div>
                                      ) : null}
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : (
                              <span className="text-xs opacity-60">No evidence rows.</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {editable && claim.safety === "needs_review" ? (
                      <form action="/api/commands" method="post" className="mt-3 space-y-2">
                        <input type="hidden" name="commandType" value="mark_claim_resolved" />
                        <input type="hidden" name="claimId" value={claim.id} />
                        <input type="hidden" name="draftVersion" value={String(draft.version)} />
                        <select
                          className={inputClass}
                          name="resolution"
                          defaultValue="manually_supported"
                        >
                          <option value="manually_supported">Manually supported</option>
                          <option value="dropped">Dropped from send criteria</option>
                        </select>
                        <textarea
                          className={textareaClass}
                          name="note"
                          placeholder="Operator note for claim-resolution audit"
                          rows={2}
                          required
                        />
                        <Button type="submit">Resolve claim</Button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Collapsible>

        {timingAdvice ? (
          <Collapsible
            title={`Timing advice · ${timingAdvice.severity}`}
            hint="Advisory only — never blocks send. Just tells you whether the recipient's local time looks reasonable right now."
          >
            <div
              className={`rounded-lg p-3 space-y-2 ${
                timingAdvice.severity === "warn"
                  ? "bg-yellow-500/10 border border-yellow-500/30"
                  : timingAdvice.severity === "advisory"
                    ? "bg-white/5 border border-white/10"
                    : "bg-emerald-500/10 border border-emerald-500/30"
              }`}
            >
              <div className="flex gap-2 items-baseline">
                <strong
                  className={
                    timingAdvice.severity === "warn"
                      ? "text-yellow-400"
                      : timingAdvice.severity === "advisory"
                        ? "opacity-80"
                        : "text-emerald-400"
                  }
                >
                  {timingAdvice.severity}
                </strong>
                <span className="text-xs opacity-60">
                  {timingAdvice.recipientTimezone ?? "tz unknown"}
                  {timingAdvice.recipientLocalHour !== null
                    ? ` · ${timingAdvice.recipientLocalHour}:00`
                    : ""}
                  {timingAdvice.isWeekend ? " · weekend" : ""}
                </span>
              </div>
              <div className="text-sm">{timingAdvice.message}</div>
              {timingAdvice.reasons.length > 0 ? (
                <div className="flex gap-1 flex-wrap">
                  {timingAdvice.reasons.map((r) => (
                    <code
                      key={r}
                      className="text-[11px] px-2 py-0.5 rounded bg-black/40 border border-white/15 font-mono"
                    >
                      {r}
                    </code>
                  ))}
                </div>
              ) : null}
            </div>
          </Collapsible>
        ) : null}

        <Collapsible
          title={`Version history · ${versionHistory.length} version${
            versionHistory.length === 1 ? "" : "s"
          }`}
          hint="Every saved version (agent-generated, operator-edited, AI-revised). The current head sits at the top of the list."
        >
          {versionHistory.length === 0 ? (
            <p className="text-sm font-light opacity-60">No prior versions recorded.</p>
          ) : (
            <ul className="space-y-3">
              {versionHistory.map((v) => {
                const isHead = v.version === draft.version;
                const excerpt = v.body.length > 280 ? `${v.body.slice(0, 280)}…` : v.body;
                return (
                  <li
                    key={v.id}
                    className="border border-white/10 rounded-xl p-3 bg-black/30 space-y-2"
                  >
                    <div className="flex justify-between gap-3 items-baseline">
                      <strong className="font-medium">
                        v{v.version}
                        {isHead ? <span className="ml-2 text-xs opacity-60">(head)</span> : null}
                      </strong>
                      <Badge tone={sourceTone(v.source)}>{v.source}</Badge>
                    </div>
                    <div className="text-xs opacity-60">
                      {v.createdAt.toISOString()} · claims_validated_version=
                      {v.claimsValidatedVersion ?? "—"}
                      {v.agentRunId ? ` · agent_run=${v.agentRunId}` : ""}
                    </div>
                    {v.corpusLabel ? (
                      <div className="text-xs opacity-70">
                        corpus:{" "}
                        <code className={`font-mono ${corpusClass(v.corpusLabel)}`}>
                          {v.corpusLabel}
                        </code>
                        {v.corpusLabelReasons.length > 0 ? (
                          <span className="ml-2">
                            ({v.corpusLabelReasons.map((r) => (
                              <code key={r} className="font-mono text-[11px] mr-1">
                                {r}
                              </code>
                            ))}
                            )
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {v.editSeverity ? (
                      <div className="text-xs opacity-70">
                        edit severity:{" "}
                        <code className={`font-mono ${severityClass(v.editSeverity)}`}>
                          {v.editSeverity}
                        </code>
                        {v.editSeveritySignals.length > 0 ? (
                          <span className="ml-2">
                            ({v.editSeveritySignals.map((s) => (
                              <code key={s} className="font-mono text-[11px] mr-1">
                                {s}
                              </code>
                            ))}
                            )
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {v.changeNotes ? (
                      <div className="text-xs italic opacity-70">&ldquo;{v.changeNotes}&rdquo;</div>
                    ) : null}
                    <details>
                      <summary className="text-xs opacity-70 cursor-pointer">{v.subject}</summary>
                      <pre className="mt-2 p-3 bg-black/40 rounded-lg text-xs whitespace-pre-wrap break-words font-mono max-h-80 overflow-auto">
                        {excerpt}
                      </pre>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </Collapsible>

        <Collapsible
          title={`Feedback log · ${feedbackRows.length} entr${
            feedbackRows.length === 1 ? "y" : "ies"
          }`}
          hint="Operator signals captured against past versions — approvals, manual edits, AI-revises, discards, tags."
        >
          {feedbackRows.length === 0 ? (
            <p className="text-sm font-light opacity-60">No feedback recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {feedbackRows.map((f) => {
                const kindTone: "accent" | "warning" | "primary" =
                  f.kind === "approve"
                    ? "accent"
                    : f.kind === "manual_edit" || f.kind === "ai_revise" || f.kind === "discard"
                      ? "warning"
                      : "primary";
                return (
                  <li
                    key={f.id}
                    className="border border-white/10 rounded-xl p-3 bg-black/30 space-y-1"
                  >
                    <div className="flex justify-between gap-3">
                      <Badge tone={kindTone}>{f.kind}</Badge>
                      <span className="text-xs opacity-60 whitespace-nowrap">
                        v{f.draftVersion} · {f.createdAt.toISOString()}
                      </span>
                    </div>
                    {f.corpusLabel ? (
                      <div className="text-xs opacity-70">
                        corpus:{" "}
                        <code className={`font-mono ${corpusClass(f.corpusLabel)}`}>
                          {f.corpusLabel}
                        </code>
                        {f.corpusLabelReasons.length > 0 ? (
                          <span className="ml-2">
                            ({f.corpusLabelReasons.map((r) => (
                              <code key={r} className="font-mono text-[11px] mr-1">
                                {r}
                              </code>
                            ))}
                            )
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {f.tags.length > 0 ? (
                      <div className="text-xs opacity-70">
                        tags:{" "}
                        {f.tags.map((t) => (
                          <code key={t} className="font-mono text-[11px] mr-1">
                            {t}
                          </code>
                        ))}
                      </div>
                    ) : null}
                    {f.note ? <div className="text-xs italic opacity-70">&ldquo;{f.note}&rdquo;</div> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Collapsible>

        {draft.workItem ? (
          <Collapsible
            title={`Linked work item · ${draft.workItem.status}`}
            hint="Inbox task that mirrors this draft. Closes automatically when you approve, discard, or resolve the underlying signal."
          >
            <InfoRow label="Type" value={<Badge>{draft.workItem.type}</Badge>} />
            <InfoRow label="Status" value={draft.workItem.status} />
            <Link
              href={`/work-items/${draft.workItem.id}`}
              className="inline-block mt-3 text-sm hover:text-[var(--accent)]"
            >
              Open work item →
            </Link>
          </Collapsible>
        ) : null}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* GROUP 4 — MODIFY. Collapsed by default. All the forms an       */}
        {/* operator might use to change the draft before approving.        */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {editable ? (
          <>
            <GroupHeader
              title="Modify"
              hint="Optional write actions. Each button opens a side panel with the relevant form. The page underneath stays where it is."
            />

            <div className="grid grid-cols-1 gap-3">
              <DraftModifyDrawers
                draftId={draft.id}
                version={draft.version}
                subject={draft.subject}
                body={draft.body}
              />

              {draftOrgId ? (
                <SideDrawer
                  triggerLabel="Investigate flagged claims (targeted research)"
                  description="Targeted re-research for THIS draft: the agent searches specifically for the claims you flag below, then writes a new snapshot version. Different from the org page's whole-org refresh."
                  title="Investigate flagged claims"
                >
                  <form action="/api/commands" method="post" className="space-y-3">
                    <input type="hidden" name="commandType" value="request_research_more" />
                    <input type="hidden" name="organizationId" value={draftOrgId} />
                    <input type="hidden" name="draftId" value={draft.id} />
                    {draft.campaign ? (
                      <input type="hidden" name="campaignId" value={draft.campaign.id} />
                    ) : null}
                    {needsReviewClaims.length > 0 ? (
                      <fieldset className="border border-white/15 rounded-lg p-3">
                        <legend className="text-xs opacity-60 px-2">
                          Flag claims to investigate (optional)
                        </legend>
                        {needsReviewClaims.map((claim) => (
                          <label key={claim.id} className="flex gap-2 items-start mb-2">
                            <input
                              type="checkbox"
                              name="unsupportedClaimIds"
                              value={claim.id}
                              defaultChecked
                              className="mt-1"
                            />
                            <span className="text-sm">{claim.claimText}</span>
                          </label>
                        ))}
                      </fieldset>
                    ) : (
                      <p className="text-sm font-light opacity-60">
                        No <code className="font-mono text-xs">needs_review</code> claims on this
                        draft — submit with the operator note alone if you still want broader
                        research.
                      </p>
                    )}
                    <textarea
                      className={textareaClass}
                      name="operatorNote"
                      placeholder="What to look for: market signals, recent press, competitors, hiring, named people..."
                      rows={5}
                      required={needsReviewClaims.length === 0}
                    />
                    <Button type="submit">Investigate flagged claims</Button>
                  </form>
                </SideDrawer>
              ) : null}

              <SideDrawer
                triggerLabel="Discard draft"
                description="Close the draft without sending. Captures a reason in the audit log. Cannot be undone."
                title="Discard draft"
                triggerTone="danger"
              >
                <form action="/api/commands" method="post" className="space-y-3">
                  <input type="hidden" name="commandType" value="discard_draft" />
                  <input type="hidden" name="draftId" value={draft.id} />
                  <input type="hidden" name="expectedVersion" value={String(draft.version)} />
                  <textarea
                    className={textareaClass}
                    name="reason"
                    placeholder="Reason for discarding"
                    rows={4}
                    required
                  />
                  <Button type="submit" tone="danger">
                    Discard draft
                  </Button>
                </form>
              </SideDrawer>
            </div>
          </>
        ) : null}
      </PageBody>
    </>
  );
}
