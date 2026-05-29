import Link from "next/link";
import type { DiscoveryCandidateView } from "@bizdev/db";
import {
  buildAcceptDiscoveryCandidateIdempotencyKey,
  buildRejectDiscoveryCandidateIdempotencyKey,
  discoveryRejectionReasonCodes,
  type DiscoveryRejectionReasonCode,
  type DiscoveryCandidateStatus
} from "@bizdev/shared";
import Card from "@/components/card";
import BlockTitle from "@/components/block-title";
import { Badge, Button, inputClass } from "@/components/ui";

// T-026AG/B: candidate panels were rendered inline on
// /campaigns/[id]/page.tsx. Moved to a shared component so the new
// /campaigns/[id]/candidates subpage can own the triage UI without
// crowding the campaign summary page.

export const CANDIDATE_STATUS_DISPLAY: Record<
  DiscoveryCandidateStatus,
  { label: string; tone: "default" | "accent" | "primary" | "warning" | "danger" }
> = {
  proposed: { label: "Proposed", tone: "primary" },
  needs_review: { label: "Needs review", tone: "warning" },
  queued_for_enrichment: { label: "Queued for enrichment", tone: "accent" },
  enriched: { label: "Enriched", tone: "accent" },
  duplicate: { label: "Duplicate", tone: "default" },
  accepted: { label: "Accepted", tone: "accent" },
  insufficient_fit: { label: "Insufficient fit", tone: "default" },
  rejected_by_policy: { label: "Rejected", tone: "danger" }
};

export const CANDIDATE_PANEL_ORDER: DiscoveryCandidateStatus[] = [
  "needs_review",
  "proposed",
  "queued_for_enrichment",
  "enriched",
  "duplicate",
  "insufficient_fit",
  "rejected_by_policy",
  "accepted"
];

const REJECTION_REASON_LABELS: Record<DiscoveryRejectionReasonCode, string> = {
  out_of_segment: "Out of segment",
  dead_company: "Dead company",
  competitor: "Competitor",
  existing_customer: "Existing customer",
  wrong_geo: "Wrong geo",
  private_pii: "Private PII",
  other: "Other"
};

function formatDiscoveryRejectionReason(code: string): string {
  return REJECTION_REASON_LABELS[code as DiscoveryRejectionReasonCode] ?? code;
}

export function DiscoveryCandidatePanels({
  candidatesByStatus
}: {
  candidatesByStatus: Record<DiscoveryCandidateStatus, DiscoveryCandidateView[]>;
}) {
  return (
    <>
      {CANDIDATE_PANEL_ORDER.map((status) => {
        const list = candidatesByStatus[status];
        if (list.length === 0) return null;
        const display = CANDIDATE_STATUS_DISPLAY[status];
        return (
          <Card key={status}>
            <div className="flex items-center gap-3 mb-4">
              <BlockTitle title={display.label} className="text-left" />
              <Badge tone={display.tone}>{list.length}</Badge>
            </div>
            <ul className="space-y-3">
              {list.map((c) => (
                <CandidateRow key={c.id} candidate={c} />
              ))}
            </ul>
          </Card>
        );
      })}
    </>
  );
}

function CandidateRow({ candidate }: { candidate: DiscoveryCandidateView }) {
  const isActionable =
    candidate.status === "proposed" ||
    candidate.status === "needs_review" ||
    candidate.status === "insufficient_fit";
  const isRejectable = isActionable || candidate.status === "duplicate";

  return (
    <li className="border border-white/10 rounded-xl p-4 bg-black/30 space-y-3">
      <div className="flex justify-between gap-3 items-start">
        <div className="min-w-0">
          <strong className="font-medium">{candidate.proposedName}</strong>
          <div className="text-xs opacity-60 mt-0.5">
            {candidate.domain ?? "no domain"}
            {candidate.countryCode ? ` · ${candidate.countryCode}` : ""}
            {candidate.region ? ` · ${candidate.region}` : ""}
            {candidate.confidence ? (
              <span title="How sure the discovery agent is that this org matches the campaign brief.">
                {" · "}{candidate.confidence} confidence
              </span>
            ) : null}
            {" · "}
            <span
              title={
                candidate.dedupeResult === "none"
                  ? "Dedupe check: no existing organisation in the DB matched this candidate."
                  : "Dedupe check: an existing organisation matched this candidate. Check the matched org before accepting."
              }
            >
              {candidate.dedupeResult === "none" ? "no duplicate" : `dedupe: ${candidate.dedupeResult}`}
            </span>
          </div>
        </div>
      </div>

      {candidate.fitRationale ? (
        <p className="text-sm font-light opacity-90">{candidate.fitRationale}</p>
      ) : null}

      {candidate.matchedOrganizationId ? (
        <div className="text-xs opacity-70">
          Matched org:{" "}
          <Link
            href={`/organizations/${candidate.matchedOrganizationId}`}
            className="text-[hsl(var(--primary))]"
          >
            {candidate.matchedOrganizationName ?? candidate.matchedOrganizationId}
          </Link>
          {candidate.matchedOrganizationDomain ? ` (${candidate.matchedOrganizationDomain})` : ""}
        </div>
      ) : null}

      {candidate.rejectionReason || candidate.rejectionReasonCode ? (
        <div className="text-xs text-red-300/80">
          Rejection:{" "}
          {candidate.rejectionReasonCode
            ? formatDiscoveryRejectionReason(candidate.rejectionReasonCode)
            : "Policy"}
          {candidate.rejectionReason ? ` · ${candidate.rejectionReason}` : ""}
        </div>
      ) : null}

      {candidate.sourceRefs.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer opacity-60">
            {candidate.sourceRefs.length} source{candidate.sourceRefs.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-1 pl-3">
            {candidate.sourceRefs.map((s, i) => (
              <li key={i} className="break-all">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[hsl(var(--primary))]"
                >
                  {s.title ?? s.url}
                </a>
                {s.snippet ? <div className="opacity-60 italic">{s.snippet}</div> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {(isActionable || isRejectable) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-white/10">
          {isActionable ? (
            <form action="/api/commands" method="post" className="space-y-2">
              <input type="hidden" name="commandType" value="accept_discovery_candidate" />
              <input type="hidden" name="candidateId" value={candidate.id} />
              <input
                type="hidden"
                name="idempotencyKey"
                value={buildAcceptDiscoveryCandidateIdempotencyKey(candidate.id, candidate.updatedAt)}
              />
              <input
                className={inputClass}
                name="organizationName"
                placeholder={`Override name (default: ${candidate.proposedName})`}
              />
              <input
                className={inputClass}
                name="domain"
                placeholder={`Override domain (default: ${candidate.domain ?? "—"})`}
              />
              <input
                className={inputClass}
                name="countryCode"
                maxLength={2}
                placeholder={`Override country, 2-letter (default: ${candidate.countryCode ?? "—"})`}
              />
              <label className="flex items-center gap-2 text-xs opacity-80">
                <input type="checkbox" name="skipEnrichment" />
                Skip research enrichment (org already has a fresh snapshot)
              </label>
              <Button type="submit" size="sm">Accept</Button>
            </form>
          ) : null}

          {isRejectable ? (
            <form action="/api/commands" method="post" className="space-y-2">
              <input type="hidden" name="commandType" value="reject_discovery_candidate" />
              <input type="hidden" name="candidateId" value={candidate.id} />
              <input
                type="hidden"
                name="idempotencyKey"
                value={buildRejectDiscoveryCandidateIdempotencyKey(candidate.id, candidate.updatedAt)}
              />
              <select className={inputClass} name="reasonCode" defaultValue="other">
                {discoveryRejectionReasonCodes.map((code) => (
                  <option key={code} value={code}>
                    {REJECTION_REASON_LABELS[code]}
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                name="reasonText"
                placeholder="Notes (optional)"
                maxLength={2000}
              />
              <Button type="submit" tone="danger" size="sm">Reject</Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
