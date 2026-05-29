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
    return {
      key: "drafting_scope",
      label: "Scope drafting",
      tone: "warning",
      description:
        "Operator is still filling in the campaign brief. Discovery will not run until the scope is saved.",
      nextAction: {
        title: "Finish scope",
        hint: "Save the campaign scope to unlock discovery.",
        href: "#scope-form"
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

  if (totals === 0 && view.recentDiscoveryRuns.length === 0) {
    return {
      key: "awaiting_discovery",
      label: "Awaiting discovery",
      tone: "primary",
      description:
        "The scope is saved but no discovery run has happened yet. Run discovery to surface candidate organisations.",
      nextAction: {
        title: "Run discovery",
        hint: "Enqueues the discovery agent against the saved scope.",
        href: "#run-discovery"
      }
    };
  }

  if (pendingTriage > 0) {
    const label = pendingTriage === 1 ? "1 candidate" : `${pendingTriage} candidates`;
    return {
      key: "triage",
      label: "Discovery — triage",
      tone: "warning",
      description: `${label} waiting for accept/reject. Enrichment only starts on accepted ones.`,
      nextAction: {
        title: `Review ${label}`,
        hint: "Jump to the candidate list and accept the orgs you want to enrich.",
        href: "#candidate-triage"
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
        href: "/organizations"
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
