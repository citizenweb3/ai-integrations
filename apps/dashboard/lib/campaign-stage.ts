// T-026AD: derives the operator-facing stage label, description, and next
// action for a campaign so the detail page can render a single "you are here"
// strip instead of forcing the operator to read four counter rows and scroll
// to figure out what to do next.
//
// The function is intentionally pure (no DB / no Date.now) and takes the
// already-loaded CampaignDiscoveryView so the same input produces the same
// stage. That makes the rules easy to unit-test and easy to extend when new
// pipeline stages land.

import type { CampaignDiscoveryView } from "@bizdev/db";

export type CampaignStageKey =
  | "drafting_scope"
  | "awaiting_discovery"
  | "triage"
  | "enrichment"
  | "drafting"
  | "sending"
  | "idle"
  | "halted";

export type CampaignStageTone = "default" | "accent" | "primary" | "warning" | "danger";

export type CampaignStageNextAction = {
  // Operator-facing imperative ("Review 5 candidates", "Run discovery").
  title: string;
  // One short sentence on what happens when the operator follows the CTA.
  hint: string;
  // In-page anchor (#id) or absolute path (/drafts) the CTA should jump to.
  href: string;
} | null;

export type CampaignStageSnapshot = {
  key: CampaignStageKey;
  // Short label rendered in the stage badge ("Discovery — triage").
  label: string;
  // One-sentence operator-facing description of what the stage means.
  description: string;
  tone: CampaignStageTone;
  // null when the stage is purely informational ("waiting for the agent").
  nextAction: CampaignStageNextAction;
};

export function deriveCampaignStage(view: CampaignDiscoveryView): CampaignStageSnapshot {
  const status = view.campaign.status;

  if (status === "drafting_scope") {
    // T-026AJ/B: split the drafting_scope rendering by whether the
    // validator has actually run yet. Right after start_campaign the
    // campaign is INSERTed with status=drafting_scope and the
    // expansion job runs the validation ~100ms-2s later. Without this
    // split the operator sees "Scope incomplete" the whole time.
    if (view.scopeValidation.state === "pending") {
      return {
        key: "drafting_scope",
        label: "Validating scope",
        tone: "primary",
        description:
          "Campaign was just submitted. The validator runs in the background and flips the campaign to active when the scope is valid. Refresh in a moment.",
        nextAction: null
      };
    }
    const missing = view.scopeValidation.missingFields;
    const description =
      missing.length === 0
        ? "The scope validator caught missing or invalid required fields. Fix them in the form below and save — discovery starts automatically once the scope is valid."
        : `Missing required scope fields: ${missing.join(", ")}. Fix them in the form below and save — discovery starts automatically once the scope is valid.`;
    return {
      key: "drafting_scope",
      label: "Scope incomplete",
      tone: "warning",
      description,
      nextAction: {
        title: "Open scope editor",
        hint: "Opens the dedicated scope editor. Discovery is auto-enqueued on a clean save.",
        href: `/campaigns/${view.campaign.id}/scope`
      }
    };
  }

  if (status !== "active") {
    return {
      key: "halted",
      label: status,
      tone: "default",
      description: `Campaign is in state "${status}" — no automated work runs in this state.`,
      nextAction: null
    };
  }

  const counts = view.candidatesByStatus;
  const totals = Object.values(counts).reduce((s, list) => s + list.length, 0);
  const pendingTriage = counts.proposed.length + counts.needs_review.length;
  const inEnrichment = counts.queued_for_enrichment.length + counts.enriched.length + counts.accepted.length;
  const draftsAwaitingReview = view.progress.draftsGenerated - view.progress.draftsApproved;
  const sendsInFlight = view.progress.draftsApproved - view.progress.sent;

  // T-026AV: stage strip must distinguish "discovery still running" from
  // "discovery succeeded with 0 candidates". The old check used
  // `recentDiscoveryRuns.length > 0` which fired even on a queued /
  // leased / running discovery row and made the page lie about an
  // in-flight job.
  const discoveryStillRunning = view.liveActivity.discoveryRunning > 0;
  const hasSucceededDiscoveryRun = view.recentDiscoveryRuns.some(
    (r) => r.jobStatus === "succeeded"
  );

  if (totals === 0 && discoveryStillRunning) {
    return {
      key: "awaiting_discovery",
      label: "Discovery running",
      tone: "primary",
      description:
        "The discovery agent is searching. Candidates appear here the moment the agent finishes — the page auto-refreshes while the job is in flight.",
      nextAction: null
    };
  }

  if (totals === 0 && !hasSucceededDiscoveryRun) {
    return {
      key: "awaiting_discovery",
      label: "Discovery starting",
      tone: "primary",
      description:
        "The scope is saved. The first discovery pass was auto-enqueued and should appear in Recent runs within seconds — the page refreshes itself while the job runs.",
      nextAction: null
    };
  }

  if (totals === 0 && hasSucceededDiscoveryRun) {
    return {
      key: "awaiting_discovery",
      label: "Discovery finished — no candidates",
      tone: "warning",
      description:
        "Discovery ran but produced 0 candidates. Tighten or widen the segments / regions, or re-run discovery to try again.",
      nextAction: {
        title: "Re-run discovery",
        hint: "Re-queues the discovery agent against the current scope (subject to the campaign cooldown).",
        href: "#run-discovery"
      }
    };
  }

  if (pendingTriage > 0) {
    const label = pendingTriage === 1 ? "1 organisation" : `${pendingTriage} organisations`;
    return {
      key: "triage",
      // Not urgent: discovery surfaced orgs the system isn't fully confident
      // about (weak/ambiguous match). They wait for the operator's judgement
      // whenever they get to it — accepted ones go on to enrichment. Calm
      // tone + soft CTA so the strip informs without nagging.
      label: "Discovery — needs your review",
      tone: "default",
      description: `The system isn't fully confident about ${label} it found and would like your confirmation before researching them. No rush — review whenever it suits you; accepted orgs move on to enrichment.`,
      nextAction: {
        title: `Review ${label} when you have a moment`,
        hint: "Open the candidate page to confirm or skip the orgs the system was unsure about.",
        href: `/campaigns/${view.campaign.id}/candidates`
      }
    };
  }

  if (inEnrichment > 0 && view.progress.draftsGenerated === 0) {
    const label = inEnrichment === 1 ? "1 organisation" : `${inEnrichment} organisations`;
    return {
      key: "enrichment",
      label: "Research in flight",
      tone: "primary",
      description: `${label} being researched. Drafts open up once research finishes and contacts get approved.`,
      nextAction: {
        title: "View organisations",
        hint: "Open the accepted organisations to follow research progress and approve contacts.",
        href: `/campaigns/${view.campaign.id}/organizations`
      }
    };
  }

  if (draftsAwaitingReview > 0) {
    const label = draftsAwaitingReview === 1 ? "1 draft" : `${draftsAwaitingReview} drafts`;
    return {
      key: "drafting",
      label: "Drafts — review",
      tone: "warning",
      description: `${label} waiting for operator review. Approve to send, edit to revise, or discard.`,
      nextAction: {
        title: `Review ${label}`,
        hint: "Open the drafts queue.",
        href: "/drafts"
      }
    };
  }

  if (sendsInFlight > 0) {
    const label = sendsInFlight === 1 ? "1 message" : `${sendsInFlight} messages`;
    return {
      key: "sending",
      label: "Sending",
      tone: "accent",
      description: `${label} approved and awaiting send. Resend dispatch happens on the worker pool.`,
      nextAction: null
    };
  }

  return {
    key: "idle",
    label: "Idle",
    tone: "default",
    description:
      "No pending operator action. Discovery cap may be reached, or all candidates have been closed out.",
    nextAction: null
  };
}
