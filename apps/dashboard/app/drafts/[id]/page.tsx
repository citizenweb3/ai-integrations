import {
  evaluatePreSendGuardrails,
  getDraftDetail,
  getDraftFeedback,
  getDraftVersionHistory,
  getResearchContextForDraft
} from "@bizdev/db";
import {
  draftFeedbackTags,
  evaluateTimingAdvice,
  nonOverridableGuardrailCodes,
  overridableGuardrailCodes
} from "@bizdev/shared";
import { notFound } from "next/navigation";
import Link from "next/link";
import ConsoleHero from "@/components/console-hero";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import { Badge, Button, InfoRow, MetricCard, PageBody, inputClass, textareaClass } from "@/components/ui";

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
  const guardrails = recipientEmail
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

  return (
    <>
      <ConsoleHero
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Status" value={draft.status} />
          <MetricCard label="Version" value={`v${draft.version}`} accent />
          <div className="rounded-2xl bg-linear-to-t from-[#7C7C81]/25 to-[#1A1A1B]/25 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
            <div className="text-xs uppercase tracking-[0.2em] opacity-60 mb-2">Contact</div>
            {draft.contact ? (
              <>
                <div className="text-sm font-medium break-all">{draft.contact.email}</div>
                <div className="text-xs opacity-60 mt-1">{draft.contact.fullName ?? "—"}</div>
                {draft.contact.organizationId ? (
                  <Link
                    href={`/organizations/${draft.contact.organizationId}`}
                    className="text-xs hover:text-[var(--accent)]"
                  >
                    org
                  </Link>
                ) : null}
              </>
            ) : (
              <p className="text-sm font-light opacity-60">No contact linked.</p>
            )}
          </div>
          <div className="rounded-2xl bg-linear-to-t from-[#7C7C81]/25 to-[#1A1A1B]/25 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
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

        <Card>
          <BlockTitle title="Quality score & readiness" className="mb-4 text-left" />
          <p className="text-xs opacity-60 mb-3">
            Rule-based, recomputed in-tx after every signal-bearing mutation (canonical §15). Annotation only — does not
            bypass operator approval.
          </p>
          {draft.qualityScore === null ? (
            <p className="text-sm font-light opacity-60">
              Not computed yet. Edit the draft, record feedback, or click recompute.
            </p>
          ) : (
            <div className="space-y-1">
              <InfoRow
                label="Score"
                value={
                  <Badge tone={bandTone(draft.qualityScoreBand)}>
                    {draft.qualityScore}/100 · {draft.qualityScoreBand}
                  </Badge>
                }
              />
              <InfoRow
                label="Readiness"
                value={
                  <span className={`font-semibold ${readinessColor(draft.autosendReadiness)}`}>
                    {draft.autosendReadiness ?? "—"}
                  </span>
                }
              />
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

        {draft.outboundMessage ? (
          <Card>
            <BlockTitle title="Outbound" className="mb-4 text-left" />
            <InfoRow label="Status" value={<Badge>{draft.outboundMessage.status}</Badge>} />
            <InfoRow label="Recipient" value={draft.outboundMessage.recipientEmail} />
            <InfoRow label="Sent at" value={draft.outboundMessage.createdAt.toISOString()} />
          </Card>
        ) : null}

        <Card>
          <BlockTitle title="Body" className="mb-4 text-left" />
          <pre className="m-0 p-3 bg-black/40 rounded-lg text-xs whitespace-pre-wrap break-words font-mono max-h-[500px] overflow-auto">
            {draft.body}
          </pre>
        </Card>

        <Card>
          <BlockTitle title="Research context" className="mb-4 text-left" />
          {!researchContext ? (
            <p className="text-sm font-light opacity-60">
              Draft has no resolvable organization (no linked contact or thread with org). The drafting agent had no
              research_snapshot to ground claims on.
            </p>
          ) : !researchContext.snapshot ? (
            <>
              <p className="text-sm font-light opacity-80 mb-2">
                <strong>{researchContext.organization.name}</strong>
                {researchContext.organization.domain ? ` · ${researchContext.organization.domain}` : ""}
              </p>
              <p className="text-sm font-light opacity-60">
                No research snapshot for this organization. Approve & send is hard-blocked by{" "}
                <code className="font-mono text-xs">claims_stale</code> until a snapshot lands (operator can trigger
                via Refresh research / Request research more).
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-light opacity-80 mb-3">
                <strong>{researchContext.organization.name}</strong>
                {researchContext.organization.domain ? ` · ${researchContext.organization.domain}` : ""} · snapshot v
                {researchContext.snapshot.version} ({researchContext.snapshot.status}) ·{" "}
                {researchContext.snapshot.createdAt.toISOString()}
              </p>
              {researchContext.facts.length === 0 ? (
                <p className="text-sm font-light opacity-60">Snapshot has no active facts.</p>
              ) : (
                <>
                  <p className="text-xs opacity-60 mb-3">
                    {researchContext.facts.filter((f) => f.cited).length} cited ·{" "}
                    {researchContext.facts.filter((f) => !f.cited).length} available · {researchContext.facts.length}{" "}
                    active facts
                  </p>
                  <ul className="space-y-3">
                    {researchContext.facts.map((fact) => (
                      <li key={fact.id} className="border border-white/10 rounded-xl p-3 bg-black/30 space-y-2">
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
                                    <div className="italic opacity-70">&ldquo;{ev.quoteText}&rdquo;</div>
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
        </Card>

        {claimsStale ? (
          <Card className="border-l-4 border-l-red-500 bg-red-500/5">
            <BlockTitle title="Claims stale" className="mb-3 text-left text-red-400" />
            <p className="text-sm font-light opacity-80">
              Draft is at v{draft.version}; claim safety last validated for v{draft.claimsValidatedVersion ?? "—"}. The
              body has changed since the last validation, so the claim list below describes a prior version.{" "}
              <strong>Approve & send is hard-blocked</strong> until revalidation finishes (worker job{" "}
              <code className="font-mono text-xs">job.revalidate_draft_claims</code>) or the operator triggers AI revise.
            </p>
          </Card>
        ) : null}

        <Card>
          <BlockTitle title="Claim safety" className="mb-4 text-left" />
          {draft.claims.length === 0 ? (
            <p className="text-sm font-light opacity-60">No claims recorded for this draft.</p>
          ) : (
            <>
              <p className="text-xs opacity-60 mb-3">
                {draft.claims.filter((c) => c.safety === "supported").length} supported ·{" "}
                {draft.claims.filter((c) => c.safety === "needs_review").length} needs review · {draft.claims.length}{" "}
                total
              </p>
              <ul className="space-y-3">
                {draft.claims.map((claim) => {
                  const isSupported = claim.safety === "supported";
                  const isDropped = claim.safety === "dropped";
                  return (
                    <li key={claim.id} className="border border-white/10 rounded-xl p-3 bg-black/30 space-y-2">
                      <div className="flex justify-between gap-3">
                        <strong className="text-sm font-medium">{claim.claimText}</strong>
                        <Badge tone={isSupported ? "accent" : isDropped ? "default" : "danger"}>
                          {claim.safety}
                        </Badge>
                      </div>
                      {claim.facts.length === 0 ? (
                        <span className={`text-xs ${isSupported ? "text-emerald-400" : "text-red-400"}`}>
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
                                          <div className="italic opacity-70">&ldquo;{ev.quoteText}&rdquo;</div>
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
                          <select className={inputClass} name="resolution" defaultValue="manually_supported">
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
            </>
          )}
        </Card>

        {editable ? (
          <Card>
            <BlockTitle title="Edit (saves new version)" className="mb-4 text-left" />
            <form action="/api/commands" method="post" className="space-y-3">
              <input type="hidden" name="commandType" value="request_manual_edit_save" />
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="expectedVersion" value={String(draft.version)} />
              <input className={inputClass} name="subject" defaultValue={draft.subject} required />
              <textarea className={textareaClass} name="body" defaultValue={draft.body} required rows={12} />
              <textarea className={textareaClass} name="notes" placeholder="Edit notes (optional)" />
              <Button type="submit">Save as v{draft.version + 1}</Button>
            </form>
          </Card>
        ) : null}

        {editable ? (
          <Card>
            <BlockTitle title="Request AI revise" className="mb-4 text-left" />
            <p className="text-sm font-light opacity-80 mb-3">
              Enqueues <code className="font-mono text-xs">job.revise_draft</code> in the{" "}
              <code className="font-mono text-xs">drafting</code> pool. The agent reads v{draft.version} + this feedback
              + the latest research snapshot, then writes v{draft.version + 1} with revalidated claims.
            </p>
            <form action="/api/commands" method="post" className="space-y-3">
              <input type="hidden" name="commandType" value="request_ai_revise" />
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="expectedVersion" value={String(draft.version)} />
              <textarea
                className={textareaClass}
                name="operatorFeedback"
                placeholder="What to change: tone, angle, ask, claims to drop, new angle to push..."
                required
                rows={5}
              />
              <Button type="submit">Request AI revise</Button>
            </form>
          </Card>
        ) : null}

        {editable && draftOrgId ? (
          <Card>
            <BlockTitle title="Request research more" className="mb-4 text-left" />
            <p className="text-sm font-light opacity-80 mb-3">
              Enqueues <code className="font-mono text-xs">job.research_more</code> in the{" "}
              <code className="font-mono text-xs">background</code> pool. The agent runs targeted searches against the
              flagged claims + your note, then writes a new <code className="font-mono text-xs">research_snapshot</code>{" "}
              version. Sharing the <code className="font-mono text-xs">research_snapshot:{draftOrgId}</code> concurrency
              key with refresh, so it serializes against vanilla refreshes.
            </p>
            <form action="/api/commands" method="post" className="space-y-3">
              <input type="hidden" name="commandType" value="request_research_more" />
              <input type="hidden" name="organizationId" value={draftOrgId} />
              <input type="hidden" name="draftId" value={draft.id} />
              {draft.campaign ? <input type="hidden" name="campaignId" value={draft.campaign.id} /> : null}
              {needsReviewClaims.length > 0 ? (
                <fieldset className="border border-white/15 rounded-lg p-3">
                  <legend className="text-xs opacity-60 px-2">Flag claims to investigate (optional)</legend>
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
                  No <code className="font-mono text-xs">needs_review</code> claims on this draft — submit with operator
                  note alone if you still want broader research.
                </p>
              )}
              <textarea
                className={textareaClass}
                name="operatorNote"
                placeholder="What to look for: market signals, recent press, competitors, hiring, named people..."
                rows={4}
                required={needsReviewClaims.length === 0}
              />
              <Button type="submit">Request research more</Button>
            </form>
          </Card>
        ) : null}

        {timingAdvice ? (
          <Card>
            <BlockTitle title="Timing advice" className="mb-4 text-left" />
            <p className="text-xs opacity-60 mb-3">
              Advisory only — never blocks send. {draft.kind === "warm" ? "Warm replies" : "Cold sends"} use{" "}
              {draft.kind === "warm" ? "lower" : "stricter"} recipient-local timing rules.
            </p>
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
                  {timingAdvice.recipientLocalHour !== null ? ` · ${timingAdvice.recipientLocalHour}:00` : ""}
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
          </Card>
        ) : null}

        {recipientEmail ? (
          <Card>
            <BlockTitle title="Pre-send guardrails" className="mb-4 text-left" />
            {guardrails.failures.length === 0 ? (
              <p className="text-sm font-light opacity-60">All checks pass. Safe to approve.</p>
            ) : (
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
            )}
          </Card>
        ) : null}

        {overrideAvailable && draft.contact ? (
          <Card className="border-l-4 border-l-yellow-500">
            <BlockTitle title="Force-send override" className="mb-4 text-left text-yellow-400" />
            <p className="text-sm font-light opacity-80 mb-3">
              All failing checks are overridable. To proceed, acknowledge EVERY code below by ticking it and supply a
              reason (10..2000 chars). Override is audited (
              <code className="font-mono text-xs">pre_send_override_applied</code> event); partial acknowledgement is
              rejected.
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
        ) : null}

        {sendable && draft.contact ? (
          <Card>
            <BlockTitle title="Approve & send" className="mb-4 text-left" />
            <p className="text-sm font-light opacity-80 mb-3">
              Approves draft v{draft.version} and enqueues outbound send via Resend.
            </p>
            <form action="/api/commands" method="post" className="space-y-3">
              <input type="hidden" name="commandType" value="approve_draft_for_send" />
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="draftVersion" value={String(draft.version)} />
              <Button type="submit">Approve and send</Button>
            </form>
          </Card>
        ) : editable && !overrideAvailable ? (
          <Card>
            <BlockTitle title="Approve & send" className="mb-4 text-left" />
            <p className="text-sm font-light opacity-60">
              {!recipientEmail
                ? "Link a contact (with email) to enable send."
                : hardFailures.length > 0
                  ? "Non-overridable blocker(s) above must be cleared at the source — no operator bypass."
                  : "Resolve the guardrail blocker(s) above before approval."}
            </p>
          </Card>
        ) : null}

        {editable ? (
          <Card>
            <BlockTitle title="Discard draft" className="mb-4 text-left" />
            <form action="/api/commands" method="post" className="space-y-3">
              <input type="hidden" name="commandType" value="discard_draft" />
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="expectedVersion" value={String(draft.version)} />
              <textarea
                className={textareaClass}
                name="reason"
                placeholder="Reason for discarding"
                rows={3}
                required
              />
              <Button type="submit" tone="danger">
                Discard draft
              </Button>
            </form>
          </Card>
        ) : null}

        <Card>
          <BlockTitle title="Version history" className="mb-4 text-left" />
          {versionHistory.length === 0 ? (
            <p className="text-sm font-light opacity-60">No prior versions recorded.</p>
          ) : (
            <ul className="space-y-3">
              {versionHistory.map((v) => {
                const isHead = v.version === draft.version;
                const excerpt = v.body.length > 280 ? `${v.body.slice(0, 280)}…` : v.body;
                return (
                  <li key={v.id} className="border border-white/10 rounded-xl p-3 bg-black/30 space-y-2">
                    <div className="flex justify-between gap-3 items-baseline">
                      <strong className="font-medium">
                        v{v.version}
                        {isHead ? <span className="ml-2 text-xs opacity-60">(head)</span> : null}
                      </strong>
                      <Badge tone={sourceTone(v.source)}>{v.source}</Badge>
                    </div>
                    <div className="text-xs opacity-60">
                      {v.createdAt.toISOString()} · claims_validated_version={v.claimsValidatedVersion ?? "—"}
                      {v.agentRunId ? ` · agent_run=${v.agentRunId}` : ""}
                    </div>
                    {v.corpusLabel ? (
                      <div className="text-xs opacity-70">
                        corpus:{" "}
                        <code className={`font-mono ${corpusClass(v.corpusLabel)}`}>{v.corpusLabel}</code>
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
                        edit_severity:{" "}
                        <code className={`font-mono ${severityClass(v.editSeverity)}`}>{v.editSeverity}</code>
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
        </Card>

        <Card>
          <BlockTitle title="Feedback" className="mb-4 text-left" />
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
                  <li key={f.id} className="border border-white/10 rounded-xl p-3 bg-black/30 space-y-1">
                    <div className="flex justify-between gap-3">
                      <Badge tone={kindTone}>{f.kind}</Badge>
                      <span className="text-xs opacity-60 whitespace-nowrap">
                        v{f.draftVersion} · {f.createdAt.toISOString()}
                      </span>
                    </div>
                    {f.corpusLabel ? (
                      <div className="text-xs opacity-70">
                        corpus:{" "}
                        <code className={`font-mono ${corpusClass(f.corpusLabel)}`}>{f.corpusLabel}</code>
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
        </Card>

        <Card>
          <BlockTitle title="Record feedback" className="mb-4 text-left" />
          <p className="text-xs opacity-60 mb-3">
            Standalone explicit signal. Pick at least one tag or write a note; both is best. Bound to v{draft.version}{" "}
            via optimistic version check.
          </p>
          <form action="/api/commands" method="post" className="space-y-3">
            <input type="hidden" name="commandType" value="record_draft_feedback" />
            <input type="hidden" name="draftId" value={draft.id} />
            <input type="hidden" name="draftVersion" value={String(draft.version)} />
            <fieldset className="border border-white/15 rounded-lg p-3">
              <legend className="text-xs opacity-60 px-2">Tags</legend>
              <div className="flex flex-wrap gap-3">
                {draftFeedbackTags.map((tag) => (
                  <label key={tag} className="inline-flex gap-2 items-center">
                    <input type="checkbox" name="tags" value={tag} />
                    <code className="font-mono text-xs">{tag}</code>
                  </label>
                ))}
              </div>
            </fieldset>
            <textarea
              className={textareaClass}
              name="note"
              placeholder="Free-form note (optional if at least one tag is checked)"
              rows={3}
            />
            <Button type="submit">Record feedback</Button>
          </form>
        </Card>

        {draft.workItem ? (
          <Card>
            <BlockTitle title="Work item" className="mb-4 text-left" />
            <InfoRow label="Type" value={<Badge>{draft.workItem.type}</Badge>} />
            <InfoRow label="Status" value={draft.workItem.status} />
            <Link
              href={`/work-items/${draft.workItem.id}`}
              className="inline-block mt-3 text-sm hover:text-[var(--accent)]"
            >
              Open work item →
            </Link>
          </Card>
        ) : null}
      </PageBody>
    </>
  );
}
