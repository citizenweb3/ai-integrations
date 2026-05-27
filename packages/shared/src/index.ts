import { z } from "zod";

export const campaignStatuses = [
  "drafting_scope",
  "active",
  "paused",
  "closed"
] as const;

export const webhookEventStatuses = [
  "received",
  "duplicate_ignored",
  "queued_for_processing",
  "processing",
  "processed",
  "processing_failed",
  "dead_lettered"
] as const;

export const commandSources = ["operator", "system", "telegram"] as const;

export const commandStatuses = [
  "accepted",
  "rejected",
  "queued",
  "executing",
  "completed",
  "failed",
  "deduplicated"
] as const;

export const operatorCommandTypes = [
  "start_campaign",
  "update_campaign_scope",
  "pause_campaign",
  "resume_campaign",
  "close_campaign",
  "resolve_work_item",
  "dismiss_work_item",
  "block_work_item",
  "snooze_work_item",
  "pause_all_sends",
  "resume_all_sends",
  "approve_draft_for_send",
  "request_manual_edit_save",
  "mark_claim_resolved",
  "discard_draft",
  "request_ai_revise",
  "request_research_more",
  "skip_draft",
  "attach_inbound_to_thread",
  "merge_threads",
  "mark_thread_manual_hold",
  "return_thread_to_agent",
  "close_thread",
  "reassign_thread_contact",
  "suppress_contact",
  "clear_suppression",
  "resolve_policy_state",
  "refresh_research_snapshot",
  "generate_draft",
  "generate_warm_draft",
  "record_draft_feedback",
  "recompute_quality_score",
  "set_primary_contact",
  "approve_contact_candidate",
  "reject_contact_candidate",
  "run_campaign_discovery",
  "accept_discovery_candidate",
  "reject_discovery_candidate"
] as const;

// Canonical §11.644-684 reply-class taxonomy. The `classify_reply` ADK
// stage emits exactly one of these per inbound message; downstream gates
// (warm-draft eligibility, wrong_person reassignment, not_now cooldown,
// unsubscribe → suppression, complaint → suppression) read this signal
// off `inbound_messages.reply_class`. A null column means the inbound
// has not been classified yet — readers must treat null as "unknown",
// not as a class. Adding a class is a schema change (CHECK constraint
// in migration 0017) so prefer overloading `noise` for novel patterns
// until the class earns its own routing.
export const replyClasses = [
  "positive_interest",
  "question",
  "neutral",
  "not_now",
  "wrong_person",
  "unsubscribe",
  "complaint",
  "out_of_office",
  "auto_reply",
  "noise"
] as const;
export type ReplyClass = (typeof replyClasses)[number];

// Confidence axis matches the research-snapshot + contact-candidate
// taxonomy already in use so the operator UI can reuse the same label
// helper. The classify_reply agent emits one of these per call.
export const replyClassConfidences = ["low", "medium", "high"] as const;
export type ReplyClassConfidence = (typeof replyClassConfidences)[number];

// Contact-candidate review lifecycle. `pending` (agent emitted, awaiting
// operator) → `converted` (operator approved, `contacts` row materialized)
// OR `rejected` (operator declined; a later research run can re-surface it).
// There is no `approved` slot: approval materializes the contact in one step,
// flipping straight to `converted`. CHECK constraint in migrations 0016/0033.
export const contactCandidateStatuses = [
  "pending",
  "rejected",
  "converted"
] as const;
export type ContactCandidateStatus = (typeof contactCandidateStatuses)[number];

// Structured reject analytics for contact candidates, mirroring
// `discoveryRejectionReasonCodes`. `reasonText` stays free-text in the
// candidate `notes` suffix; `reasonCode` is the queryable taxonomy.
// CHECK constraint in migration 0032. Adding a code is a schema change.
export const contactRejectionReasonCodes = [
  "wrong_person",
  "left_company",
  "private_pii",
  "duplicate_of",
  "low_confidence",
  "other"
] as const;
export type ContactRejectionReasonCode = (typeof contactRejectionReasonCodes)[number];

// Canonical §67 prospect-discovery candidate lifecycle. The
// `campaign_discovery` ADK stage produces proposals; worker validates +
// dedupes + policy-gates; operator accepts/rejects. CHECK constraint in
// migration 0018. Adding a status is a schema change.
//   proposed                — agent output, fresh, no dedupe match
//   accepted                — operator accepted, organization linked
//   duplicate               — strong dedupe match (auto-linked, suppressed)
//   rejected_by_policy      — suppression / cooldown / legal block
//   insufficient_fit        — agent self-flagged low confidence
//   needs_review            — medium/weak dedupe ambiguity
//   queued_for_enrichment   — accepted, refresh_research_snapshot enqueued
//   enriched                — research snapshot landed
export const discoveryCandidateStatuses = [
  "proposed",
  "accepted",
  "duplicate",
  "rejected_by_policy",
  "insufficient_fit",
  "needs_review",
  "queued_for_enrichment",
  "enriched"
] as const;
export type DiscoveryCandidateStatus = (typeof discoveryCandidateStatuses)[number];

export const discoveryRejectionReasonCodes = [
  "out_of_segment",
  "dead_company",
  "competitor",
  "existing_customer",
  "wrong_geo",
  "private_pii",
  "other"
] as const;
export type DiscoveryRejectionReasonCode = (typeof discoveryRejectionReasonCodes)[number];

// Canonical §67 dedupe rubric. `strong` (exact domain match or canonical
// name+country match) → auto-link, status flips to `duplicate`. `medium`
// (fuzzy name match same country, or domain shares root) / `weak` (loose
// name similarity only) → status flips to `needs_review` for operator
// disambiguation. `none` → novel, status stays `proposed`.
export const dedupeResults = ["none", "strong", "medium", "weak"] as const;
export type DedupeResult = (typeof dedupeResults)[number];

export const jobTypes = [
  "job.start_campaign_expansion",
  "job.process_webhook_event",
  "job.process_provider_event",
  "job.enrich_organization",
  "job.refresh_research_snapshot",
  "job.research_more",
  "job.discover_contacts",
  "job.select_primary_contact",
  "job.generate_cold_draft",
  "job.generate_warm_draft",
  "job.revise_draft",
  "job.revalidate_draft_claims",
  "job.classify_reply",
  "job.attempt_thread_match",
  "job.index_rag_document",
  "job.refresh_thread_summary",
  "job.recompute_work_items",
  "job.recompute_quality_score",
  "job.recompute_readiness_label",
  "job.send_email",
  "job.send_telegram_notification",
  "job.resurface_policy_states",
  "job.cron_recover_stale_jobs",
  "job.cron_worker_heartbeat_watchdog",
  "job.cron_queue_depth_watchdog",
  "job.cron_rotate_event_log",
  "job.cron_rollup_agent_costs",
  "job.run_campaign_discovery"
] as const;

export const jobStatuses = [
  "queued",
  "leased",
  "running",
  "succeeded",
  "failed",
  "dead_lettered",
  "cancelled"
] as const;

export const eventTypes = [
  "command_accepted",
  "command_deduplicated",
  "campaign_created",
  "campaign_scope_updated",
  "campaign_scope_incomplete",
  "campaign_expansion_started",
  "campaign_expansion_completed",
  "job_started",
  "job_succeeded",
  "job_failed",
  "job_retry_scheduled",
  "job_dead_lettered",
  "stale_jobs_recovered",
  "worker_unhealthy",
  "queue_backlog_detected",
  "event_log_rotated",
  "agent_costs_rolled_up",
  "agent_cost_spike",
  "webhook_event_received",
  "webhook_event_duplicate_ignored",
  "webhook_event_queued_for_processing",
  "webhook_event_processed",
  "suppression_entry_created",
  "inbound_message_persisted",
  "outbound_delivery_updated",
  "provider_event_unmatched",
  "complaint_received",
  "hard_bounce_received",
  "unsubscribe_received",
  "work_item_resolved",
  "work_item_dismissed",
  "work_item_blocked",
  "work_item_snoozed",
  "thread_summary_refreshed",
  "inbound_message_attached_to_thread",
  "thread_created",
  "suppression_cleared",
  "policy_state_resolved",
  "draft_created",
  "draft_updated",
  "agent_run_started",
  "agent_run_completed",
  "agent_run_failed",
  "research_snapshot_refreshed",
  "research_snapshot_router_failed",
  "contact_discovery_completed",
  "contact_discovery_router_failed",
  "manual_org_research_completed",
  "organization_primary_contact_set",
  "contact_candidate_approved",
  "contact_candidate_rejected",
  "reply_classified",
  "reply_classification_router_failed",
  "reply_classification_skipped",
  "reply_class_routed",
  "warm_reply_eligible",
  "draft_email_aborted_suppressed",
  "draft_email_generated",
  "draft_email_router_failed",
  "warm_draft_requested",
  "warm_draft_created",
  "warm_draft_router_failed",
  "draft_revised",
  "draft_revise_router_failed",
  "draft_manual_edit_saved",
  "draft_claim_resolved",
  "draft_discarded",
  "draft_claims_revalidated",
  "draft_claims_revalidation_router_failed",
  "draft_claims_revalidation_skipped",
  "draft_claims_revalidated_zero_claims",
  "draft_research_more_requested",
  "research_more_router_failed",
  "draft_feedback_recorded",
  "quality_score_updated",
  "autosend_readiness_updated",
  "pre_send_guardrails_failed",
  "pre_send_override_applied",
  "pre_send_override_rejected",
  "system_sends_paused",
  "system_sends_resumed",
  "telegram_notification_sent",
  "telegram_notification_skipped",
  "telegram_notification_failed",
  "telegram_inbound_received",
  "telegram_inbound_duplicate_ignored",
  "telegram_inbound_processing_failed",
  "telegram_command_acknowledged",
  "telegram_command_unknown",
  "telegram_command_unauthorized",
  "telegram_command_failed",
  "campaign_discovery_started",
  "campaign_discovery_completed",
  "campaign_discovery_router_failed",
  "campaign_discovery_cap_reached",
  "campaign_discovery_cooldown_started",
  "discovery_candidate_proposed",
  "discovery_candidate_accepted",
  "discovery_candidate_rejected",
  "discovery_candidate_auto_linked",
  "organization_dedupe_review_needed"
] as const;

export const agentTokenUsageSchema = z.object({
  promptTokens: z.number().int().min(0).default(0),
  completionTokens: z.number().int().min(0).default(0),
  totalTokens: z.number().int().min(0).default(0),
  modelId: z.string().trim().min(1).max(200),
  costUsd: z.number().min(0).optional(),
  latencyMs: z.number().int().min(0).optional()
}).strict();

// Per canonical §11.657-662 + §12.710-713: cold (campaign outreach) and warm
// (in-thread reply) drafts have different policy buckets and operator flows;
// the kind is stored on the `drafts` row at creation time.
export const draftKinds = ["cold", "warm"] as const;
export type DraftKind = (typeof draftKinds)[number];

// Per canonical §62 the feedback corpus has a fixed kind set so downstream
// learning routers can deterministically split positive vs negative signals.
// `manual_edit` / `ai_revise` / `discard` carry implicit negative signal;
// `approve` (no edits between agent_revised and approve) is positive;
// `explicit` is reserved for the standalone `record_draft_feedback` command
// where the operator types a freeform note without a state transition.
export const draftFeedbackKinds = [
  "manual_edit",
  "ai_revise",
  "approve",
  "discard",
  "explicit"
] as const;
export type DraftFeedbackKind = (typeof draftFeedbackKinds)[number];

// Fixed taxonomy. Adding a tag is a schema change (downstream learning
// pipelines pivot on the exact string), so prefer overloading `note` for
// novel signals until a tag earns its place.
export const draftFeedbackTags = [
  "tone_off",
  "wrong_claim",
  "weak_ask",
  "factual_error",
  "length_off",
  "good_hook",
  "wrong_target",
  "irrelevant_research",
  "other"
] as const;
export type DraftFeedbackTag = (typeof draftFeedbackTags)[number];

export const draftFeedbackTagSchema = z.enum(draftFeedbackTags);

// Canonical §15 — rule-based quality score band, recomputed in-tx after every
// signal-bearing mutation (create / edit / revise / approve / feedback / claim
// revalidation). Score is 0..100, band is the human-readable bucket. Reason
// tags are stored alongside the number so the UI can show *why* (the design
// doc explicitly calls this out: "Quality score should store reason tags, not
// just a number").
export const qualityScoreBands = ["low", "medium", "high"] as const;
export type QualityScoreBand = (typeof qualityScoreBands)[number];

// Canonical §15.842-855 — autosend readiness label is an annotation only in
// MVP. It does not control sending; operator approval is still mandatory.
// `blocked_by_*` codes mirror pre-send guardrail failure modes; the
// score-driven labels (`low_confidence` / `promising` / `high_confidence`)
// surface as inbox sort hints once Phase 5 wires them.
export const autosendReadinessLabels = [
  "not_ready",
  "low_confidence",
  "promising",
  "high_confidence",
  "blocked_by_policy",
  "blocked_by_facts"
] as const;
export type AutosendReadinessLabel = (typeof autosendReadinessLabels)[number];

// Reason-tag taxonomy for `qualityScoreReasons`. Each tag corresponds to a
// signal channel that contributed to the score. Adding a tag is a schema
// change because the UI key-maps human-readable copy off these strings.
// Canonical §15.800-822 — deterministic edit severity labels. Computed in-tx
// at every operator manual-edit save by diffing (prevSubject, prevBody) vs
// (newSubject, newBody). Is a learning signal only — never blocks a send.
export const editSeverityLabels = ["none", "minor", "moderate", "major", "rewrite"] as const;
export type EditSeverity = (typeof editSeverityLabels)[number];

// Sub-signals that fed into the severity decision. Stored alongside the label
// in `draft_versions.edit_severity_signals` so the UI / learning pipeline can
// see *which* signals fired, not just the rolled-up label. Adding a signal is
// a schema change.
export const editSeveritySignalTags = [
  "subject_changed",
  "body_unchanged",
  "body_diff_minor",
  "body_diff_moderate",
  "body_diff_major",
  "length_change_major"
] as const;
export type EditSeveritySignalTag = (typeof editSeveritySignalTags)[number];

// Canonical §62.5937-5983 — every draft_versions and draft_feedback row is
// routed to one of the learning corpora at write time so Phase 6 RAG can
// pull positive examples and negative anti-patterns separately. `neutral`
// rows are kept for audit/debug but excluded from retrieval. Safe research
// facts use the `research_fact` corpus for factual retrieval.
export const corpusLabels = ["positive", "negative", "neutral", "research_fact"] as const;
export type CorpusLabel = (typeof corpusLabels)[number];

// Why the router picked the label. Whitelist guards downstream pipelines
// pivoting on the exact string; adding a reason is a schema change.
export const corpusLabelReasonTags = [
  // positive
  "approved_clean",
  "approved_minor_edit",
  "feedback_good_hook",
  // negative
  "discarded",
  "ai_revise_requested",
  "manual_edit_major",
  "manual_edit_rewrite",
  "feedback_anti_pattern",
  "policy_blocker_open",
  "claim_needs_review",
  // neutral
  "superseded_no_feedback",
  "no_decision_yet",
  "freeform_note_no_signal"
] as const;
export type CorpusLabelReasonTag = (typeof corpusLabelReasonTags)[number];

// Tags from `draftFeedbackTags` that count as "anti-pattern" signal. Anything
// listed here flips an otherwise neutral artifact to negative. `good_hook` is
// the only positive-leaning tag; `other` is treated as no signal.
export const corpusNegativeFeedbackTags: readonly DraftFeedbackTag[] = [
  "tone_off",
  "wrong_claim",
  "weak_ask",
  "factual_error",
  "length_off",
  "wrong_target",
  "irrelevant_research"
];

// Phase 6 RAG: artifact kinds that get indexed into rag_documents. The
// retriever filters by these + corpus_label + organization scope.
export const ragArtifactKinds = ["draft_version", "draft_feedback", "research_fact"] as const;
export type RagArtifactKind = (typeof ragArtifactKinds)[number];

// RAG embedding provider taxonomy. `stub` writes a deterministic zero-vector
// for pipeline scaffolding tests; `gemini` and `openai` slots reserved for
// the R2 slice that wires real embedding APIs.
export const ragEmbeddingProviders = ["stub", "gemini", "openai"] as const;
export type RagEmbeddingProvider = (typeof ragEmbeddingProviders)[number];

// Default chunk size for RAG indexing (in characters). 1500 ≈ 350-400 tokens
// — fits well under the typical embedding model context window with room for
// metadata; larger chunks lose retrieval precision, smaller ones inflate
// vector storage.
export const ragChunkMaxChars = 1500;

export const qualityScoreReasonTags = [
  "no_claims",
  "claim_safety_supported",
  "claim_safety_needs_review",
  "claims_fresh",
  "claims_stale",
  "operator_approved",
  "operator_edited_minor",
  "operator_edited_moderate",
  "operator_edited_major",
  "operator_edited_rewrite",
  "operator_revised",
  "feedback_negative_explicit",
  "feedback_positive_explicit",
  "policy_blocked"
] as const;
export type QualityScoreReasonTag = (typeof qualityScoreReasonTags)[number];

// Canonical §66.5404-5426 — pre-send guardrail failure codes split into
// override-able vs hard. Operator may force a send past an overridable code
// by acknowledging it + supplying a written reason; hard codes never bypass.
//
// Hard codes (per spec): unsubscribe / complaint / hard bounce, compliance
// hard block, duplicate send idempotency conflict, unsupported central claim.
// MVP additions to the hard set: pending suppression-class webhook (could be
// about to apply unsubscribe/complaint/hard_bounce), and precondition errors
// (`draft_not_found` / `draft_version_mismatch` / `invalid_recipient`) which
// describe state-not-found rather than policy.
//
// `active_suppression` is split at evaluation time by `suppression_entries.reason`:
// reasons in `hardSuppressionReasons` are unconditionally hard; everything
// else (operator-set "do_not_contact" etc.) routes to the soft set so the
// operator can override after re-confirming.
export const overridableGuardrailCodes = [
  "claims_stale",
  "claim_safety_unresolved",
  "thread_active_send",
  "unresolved_send_ambiguity",
  "policy_blocks_scope",
  "active_suppression_soft",
  "autosend_readiness_blocked_by_policy",
  "campaign_paused"
] as const;
export type OverridableGuardrailCode = (typeof overridableGuardrailCodes)[number];

export const nonOverridableGuardrailCodes = [
  "draft_not_found",
  "draft_version_mismatch",
  "draft_not_sendable",
  "duplicate_send",
  "invalid_recipient",
  "claims_no_org_context",
  "autosend_readiness_not_ready",
  "campaign_not_active",
  "campaign_archived",
  "pending_suppression_webhook",
  "active_suppression_hard",
  "system_pause"
] as const;
export type NonOverridableGuardrailCode = (typeof nonOverridableGuardrailCodes)[number];

// Suppression reasons that may NEVER be overridden — these come from provider
// signals (the recipient asked us to stop) and overriding them is illegal in
// most jurisdictions. Anything not in this list is treated as operator-set
// and is overridable after re-acknowledgement.
export const hardSuppressionReasons = ["unsubscribe", "complaint", "hard_bounce"] as const;
export type HardSuppressionReason = (typeof hardSuppressionReasons)[number];

export const manualOverrideSchema = z.object({
  acknowledgedCodes: z
    .array(z.enum(overridableGuardrailCodes))
    .min(1)
    .max(overridableGuardrailCodes.length),
  reason: z.string().trim().min(10).max(2000)
});
export type ManualOverride = z.infer<typeof manualOverrideSchema>;

export const workItemActions = ["resolve", "dismiss", "block", "snooze"] as const;

export const outboundMessageStatuses = [
  "send_requested",
  "sent",
  "send_ambiguous",
  "send_failed",
  "delivery_delivered",
  "delivery_bounced",
  "complained",
  "suppressed_after_send"
] as const;

export const startCampaignPayloadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  objective: z.string().trim().min(1).max(2000),
  offerSummary: z.string().trim().max(2000).optional(),
  desiredCta: z.string().trim().max(500).optional(),
  targetSegments: z.array(z.string().trim().min(1).max(200)).default([]),
  forbiddenClaims: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  senderIdentityId: z.string().uuid().optional(),
  policyProfileId: z.string().uuid().optional(),
  operatorNotes: z.string().trim().max(4000).optional(),
  discoverySourceHints: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  discoveryExclusions: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  allowedRegions: z.array(z.string().trim().min(1).max(120)).max(25).default([]),
  maxOrganizationsToDiscover: z.number().int().min(1).max(500).default(25),
  maxConcurrentEnrichments: z.number().int().min(1).max(100).default(3),
  maxConcurrentDrafts: z.number().int().min(1).max(100).default(5),
  maxOpenDraftReviews: z.number().int().min(1).max(500).default(25),
  cooldownBetweenDiscoverySeconds: z.number().int().min(0).max(604800).default(3600),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const updateCampaignScopePayloadSchema = z.object({
  campaignId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  objective: z.string().trim().min(1).max(2000).optional(),
  offerSummary: z.string().trim().max(2000).nullable().optional(),
  desiredCta: z.string().trim().max(500).nullable().optional(),
  targetSegments: z.array(z.string().trim().min(1).max(200)).optional(),
  forbiddenClaims: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  senderIdentityId: z.string().uuid().nullable().optional(),
  policyProfileId: z.string().uuid().nullable().optional(),
  operatorNotes: z.string().trim().max(4000).nullable().optional(),
  discoverySourceHints: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  discoveryExclusions: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  allowedRegions: z.array(z.string().trim().min(1).max(120)).max(25).optional(),
  maxOrganizationsToDiscover: z.number().int().min(1).max(500).optional(),
  maxConcurrentEnrichments: z.number().int().min(1).max(100).optional(),
  maxConcurrentDrafts: z.number().int().min(1).max(100).optional(),
  maxOpenDraftReviews: z.number().int().min(1).max(500).optional(),
  cooldownBetweenDiscoverySeconds: z.number().int().min(0).max(604800).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

const isoDatetimeStringSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Must be a valid datetime");

export const pauseAllSendsPayloadSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
  expiresAt: isoDatetimeStringSchema.optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const resumeAllSendsPayloadSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const approveDraftForSendPayloadSchema = z
  .object({
    draftId: z.string().uuid(),
    draftVersion: z.number().int().min(1),
    manualOverride: manualOverrideSchema.optional()
  })
  .strict();

export const attachInboundToThreadPayloadSchema = z
  .object({
    inboundMessageId: z.string().uuid(),
    threadId: z.string().uuid().optional(),
    createNewThread: z.boolean().optional(),
    campaignId: z.string().uuid().optional(),
    organizationId: z.string().uuid().optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional()
  })
  .refine(
    (value) => Boolean(value.threadId) !== Boolean(value.createNewThread),
    { message: "Provide exactly one of threadId or createNewThread" }
  );

export const mergeThreadsPayloadSchema = z
  .object({
    primaryThreadId: z.string().uuid(),
    secondaryThreadId: z.string().uuid(),
    reason: z.string().trim().min(3).max(2000),
    idempotencyKey: z.string().trim().min(1).max(200).optional()
  })
  .refine(
    (value) => value.primaryThreadId !== value.secondaryThreadId,
    { message: "primaryThreadId and secondaryThreadId must differ", path: ["secondaryThreadId"] }
  );

export const createDraftPayloadSchema = z.object({
  campaignId: z.string().uuid().optional(),
  threadId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(60000),
  recipientEmail: z.string().trim().toLowerCase().email().max(320).optional(),
  fromEmail: z.string().trim().toLowerCase().email().max(320).optional(),
  notes: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const requestManualEditSavePayloadSchema = z.object({
  draftId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(60000),
  notes: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const markClaimResolvedPayloadSchema = z.object({
  claimId: z.string().uuid(),
  draftVersion: z.number().int().min(1),
  resolution: z.enum(["manually_supported", "dropped"]),
  note: z.string().trim().min(1).max(2000),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const discardDraftPayloadSchema = z.object({
  draftId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().min(1).max(2000),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export function buildCreateDraftIdempotencyKey(
  hashSeed: string
): string {
  return `create_draft:${hashSeed}:v1`;
}

export function buildManualEditSaveIdempotencyKey(
  draftId: string,
  expectedVersion: number,
  bodyHash: string
): string {
  return `manual_edit:${draftId}:v${expectedVersion}:${bodyHash}:v1`;
}

export function buildMarkClaimResolvedIdempotencyKey(
  claimId: string,
  draftVersion: number,
  resolution: string,
  noteHash: string
): string {
  return `mark_claim_resolved:${claimId}:v${draftVersion}:${resolution}:${noteHash}:v1`;
}

export function buildDiscardDraftIdempotencyKey(
  draftId: string,
  expectedVersion: number,
  reasonHash: string
): string {
  return `discard_draft:${draftId}:v${expectedVersion}:${reasonHash}:v1`;
}

export const suppressionReasons = [
  "complaint",
  "hard_bounce",
  "unsubscribe",
  "manual_block",
  "operator_request",
  "do_not_contact"
] as const;

export const suppressContactPayloadSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  reason: z.enum(suppressionReasons),
  source: z.string().trim().min(1).max(100).default("operator"),
  notes: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const clearSuppressionPayloadSchema = z.object({
  suppressionId: z.string().uuid(),
  reasonText: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const resolvePolicyStatePayloadSchema = z.object({
  policyStateId: z.string().uuid(),
  reasonText: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const setPrimaryContactPayloadSchema = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  reasonText: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const approveContactCandidatePayloadSchema = z.object({
  candidateId: z.string().uuid(),
  // Operator can override the agent-emitted role/email/fullName before
  // promoting to a contacts row (the candidate text is agent output and
  // may need light cleanup). All three are optional — empty / omitted
  // means use the candidate's current value.
  email: z.string().trim().toLowerCase().email().max(320).optional(),
  fullName: z.string().trim().min(1).max(200).optional(),
  roleTitle: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  confirmReattach: z.boolean().optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const rejectContactCandidatePayloadSchema = z.object({
  candidateId: z.string().uuid(),
  reasonCode: z.enum(contactRejectionReasonCodes).optional(),
  reasonText: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

// Canonical §67 prospect discovery — operator triggers a discovery pass
// for a campaign. The worker enqueues `job.run_campaign_discovery`,
// which invokes the `campaign_discovery` ADK stage with the campaign
// brief and persistent discovery hints stored on the campaign row.
export const runCampaignDiscoveryPayloadSchema = z.object({
  campaignId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

// Operator accepts a `proposed` / `needs_review` candidate. Worker
// materializes an `organizations` row (or links to `matchedOrganizationId`
// on weak/medium accepted match), flips status to `queued_for_enrichment`,
// enqueues `job.refresh_research_snapshot`. Operator may override the
// agent-emitted name / domain before promotion.
export const acceptDiscoveryCandidatePayloadSchema = z
  .object({
    candidateId: z.string().uuid(),
    organizationName: z.string().trim().min(1).max(200).optional(),
    domain: z.string().trim().toLowerCase().max(253).optional(),
    countryCode: z.string().trim().toUpperCase().length(2).optional(),
    // When the candidate landed in `needs_review` because of medium/weak
    // dedupe, the operator may explicitly link it to the existing
    // organization instead of creating a new one. Worker validates the id
    // exists; mutually exclusive with overriding name/domain/countryCode
    // (linking adopts the target org's identity, overrides would be
    // ambiguous).
    linkToOrganizationId: z.string().uuid().optional(),
    // Skip the auto-chained research enrichment (e.g. a fresh snapshot already
    // exists for the resolved org). When true the candidate is accepted +
    // org-linked but no `refresh_research_snapshot` job is queued.
    skipEnrichment: z.boolean().optional(),
    notes: z.string().trim().max(2000).optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional()
  })
  .refine(
    (v) =>
      !v.linkToOrganizationId ||
      (!v.organizationName && !v.domain && !v.countryCode),
    {
      message:
        "linkToOrganizationId is mutually exclusive with organizationName / domain / countryCode overrides",
      path: ["linkToOrganizationId"]
    }
  );

export const rejectDiscoveryCandidatePayloadSchema = z.object({
  candidateId: z.string().uuid(),
  reasonCode: z.enum(discoveryRejectionReasonCodes).optional(),
  reasonText: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const refreshResearchSnapshotPayloadSchema = z.object({
  organizationId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(8000),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const generateDraftPayloadSchema = z.object({
  organizationId: z.string().uuid(),
  operatorBrief: z.string().trim().min(1).max(8000),
  campaignId: z.string().uuid().optional(),
  threadId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

// Warm draft = in-thread reply (canonical §11.657-662 + §42.2902-2916). Bound
// to a thread, not an organization. `replyIntent` is operator-supplied free
// text that stands in for the canonical `reply_class` input (we don't have a
// `classify_reply` stage in MVP — the operator supplies intent implicitly by
// triggering the draft). `targetContactId` is optional override; default
// resolution = sender of the latest inbound message in the thread.
export const generateWarmDraftPayloadSchema = z.object({
  threadId: z.string().uuid(),
  replyIntent: z.string().trim().min(1).max(8000),
  targetContactId: z.string().uuid().optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const requestAiRevisePayloadSchema = z.object({
  draftId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  operatorFeedback: z.string().trim().min(1).max(8000),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const requestResearchMorePayloadSchema = z.object({
  organizationId: z.string().uuid(),
  draftId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  // unsupported claim ids the operator wants the agent to investigate further;
  // empty array allowed (operator may request research-more from operator-note
  // alone) but at least one of (claimIds, operatorNote) must be non-empty —
  // enforced via .refine below
  unsupportedClaimIds: z.array(z.string().uuid()).max(50).default([]),
  // currentSnapshotId is optional metadata: lets the worker compare the
  // produced snapshot against the one the operator was looking at when they
  // submitted the request (canonical §61.4534)
  currentSnapshotId: z.string().uuid().optional(),
  operatorNote: z.string().trim().max(4000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
}).refine(
  (v) => v.unsupportedClaimIds.length > 0 || (v.operatorNote?.length ?? 0) > 0,
  { message: "Provide at least one of unsupportedClaimIds or operatorNote" }
);

export const recordDraftFeedbackPayloadSchema = z.object({
  draftId: z.string().uuid(),
  // Caller-supplied — operator may want to attach feedback to a prior version
  // they were reviewing, so this is not derived from `drafts.version` at
  // command time. Validation in the repo refuses if the version no longer
  // matches the head (stale UI guard).
  draftVersion: z.number().int().min(1),
  tags: z.array(draftFeedbackTagSchema).max(draftFeedbackTags.length).default([]),
  note: z.string().trim().min(1).max(4000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
}).refine(
  (v) => v.tags.length > 0 || (v.note?.length ?? 0) > 0,
  { message: "Provide at least one of tags or note", path: ["tags"] }
);

// Manual recompute trigger. The recompute logic also runs automatically
// in-tx after every signal-bearing mutation, so this command exists for
// (a) ops debugging when a stale row is suspected and (b) seeding scores on
// pre-existing drafts that predate the migration.
export const recomputeQualityScorePayloadSchema = z.object({
  draftId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export function buildRecomputeQualityScoreIdempotencyKey(
  draftId: string,
  triggeredAt: Date
): string {
  return `recompute_quality_score:${draftId}:${triggeredAt.toISOString()}:v1`;
}

export function buildRecordDraftFeedbackIdempotencyKey(
  draftId: string,
  draftVersion: number,
  tagsHash: string,
  noteHash: string
): string {
  return `record_draft_feedback:${draftId}:v${draftVersion}:${tagsHash}:${noteHash}:v1`;
}

export function buildSuppressContactIdempotencyKey(
  email: string,
  reason: string,
  stateVersion: string
): string {
  return `suppress_contact:${email.trim().toLowerCase()}:${reason}:${stateVersion}:v1`;
}

export function buildClearSuppressionIdempotencyKey(
  suppressionId: string,
  stateVersion: Date
): string {
  return `clear_suppression:${suppressionId}:${stateVersion.toISOString()}:v1`;
}

export function buildResolvePolicyStateIdempotencyKey(
  policyStateId: string,
  stateVersion: Date
): string {
  return `resolve_policy_state:${policyStateId}:${stateVersion.toISOString()}:v1`;
}

export function buildSetPrimaryContactIdempotencyKey(
  organizationId: string,
  contactId: string,
  stateVersion: Date
): string {
  return `set_primary_contact:${organizationId}:${contactId}:${stateVersion.toISOString()}:v1`;
}

export function buildPauseAllSendsIdempotencyKey(
  reasonHash: string,
  expiresAt: string | null,
  stateVersion: Date | null
): string {
  return `pause_all_sends:${reasonHash}:${expiresAt ?? "no_expiry"}:${stateVersion?.toISOString() ?? "initial"}:v1`;
}

export function buildResumeAllSendsIdempotencyKey(stateVersion: Date | null): string {
  return `resume_all_sends:${stateVersion?.toISOString() ?? "initial"}:v1`;
}

export function buildApproveContactCandidateIdempotencyKey(
  candidateId: string,
  // Action is bound to the candidate row's current state; once approved
  // the row's state version moves on so a later replay with a stale
  // updatedAt deduplicates against the ORIGINAL approve, which is what
  // we want — the candidate is now `converted` and a re-approve is a
  // no-op.
  stateVersion: Date
): string {
  return `approve_contact_candidate:${candidateId}:${stateVersion.toISOString()}:v1`;
}

export function buildRejectContactCandidateIdempotencyKey(
  candidateId: string,
  stateVersion: Date
): string {
  return `reject_contact_candidate:${candidateId}:${stateVersion.toISOString()}:v1`;
}

export function buildRunCampaignDiscoveryIdempotencyKey(
  campaignId: string,
  scopeVersion: number,
  triggeredAt: Date
): string {
  // Scope version changes when persistent discovery hints/exclusions
  // change. Triggered-at remains the trailing state-version slot per the
  // shared `<scope>:<id>:...:<state_version>:v1` convention; the active
  // discovery cooldown handles same-scope rapid replays.
  return `run_campaign_discovery:${campaignId}:scope_v${scopeVersion}:${triggeredAt.toISOString()}:v1`;
}

export function buildAcceptDiscoveryCandidateIdempotencyKey(
  candidateId: string,
  // Bound to the candidate row's current state — once accepted, status
  // moves to `queued_for_enrichment` and the updatedAt advances, so a
  // stale replay deduplicates against the original accept (which is
  // exactly the desired no-op).
  stateVersion: Date
): string {
  return `accept_discovery_candidate:${candidateId}:${stateVersion.toISOString()}:v1`;
}

export function buildRejectDiscoveryCandidateIdempotencyKey(
  candidateId: string,
  stateVersion: Date
): string {
  return `reject_discovery_candidate:${candidateId}:${stateVersion.toISOString()}:v1`;
}

export function buildRefreshResearchSnapshotIdempotencyKey(
  organizationId: string,
  triggeredAt: Date
): string {
  return `refresh_research_snapshot:${organizationId}:${triggeredAt.toISOString()}:v1`;
}

export function buildGenerateDraftIdempotencyKey(
  organizationId: string,
  triggeredAt: Date,
  briefHash: string
): string {
  // Brief hash is part of the seed so two distinct briefs submitted within
  // the same millisecond do not silently dedupe to one job.
  return `generate_draft:${organizationId}:${briefHash}:${triggeredAt.toISOString()}:v1`;
}

export function buildGenerateWarmDraftIdempotencyKey(
  threadId: string,
  latestInboundMessageId: string,
  intentHash: string
): string {
  // Per canonical §35: warm draft jobs are scoped per thread. Latest-inbound
  // id ties the dedupe to the specific message the operator is replying to,
  // so requesting another draft after a NEW inbound arrives is a different
  // request (does not collapse). Intent hash splits distinct operator intent,
  // but identical retries/clicks for the same thread+inbound+intent dedupe.
  return `generate_warm_draft:${threadId}:${latestInboundMessageId}:${intentHash}:v2`;
}

export function buildRequestAiReviseIdempotencyKey(
  draftId: string,
  expectedVersion: number,
  feedbackHash: string
): string {
  return `request_ai_revise:${draftId}:v${expectedVersion}:${feedbackHash}:v1`;
}

export function buildRequestResearchMoreIdempotencyKey(
  organizationId: string,
  draftId: string | null,
  claimIdsHash: string,
  noteHash: string
): string {
  // Per canonical §61.4573: scope = operator id + draft id + claim ids +
  // normalized note hash. We omit operatorId here because actorId may be
  // absent in single-operator MVP; the join of (orgId|draftId, claim+note
  // hashes) is still unique-enough to prevent accidental dedupe collisions.
  return `request_research_more:${organizationId}:${draftId ?? "no_draft"}:${claimIdsHash}:${noteHash}:v1`;
}

export function buildUpdateCampaignScopeIdempotencyKey(
  campaignId: string,
  scopeHash: string
): string {
  return `update_campaign_scope:${campaignId}:${scopeHash}:v1`;
}

export const createCommandRequestSchema = z.discriminatedUnion("commandType", [
  z.object({
    commandType: z.literal("start_campaign"),
    actorId: z.string().uuid().optional(),
    payload: startCampaignPayloadSchema
  }),
  z.object({
    commandType: z.literal("update_campaign_scope"),
    actorId: z.string().uuid().optional(),
    payload: updateCampaignScopePayloadSchema
  }),
  z.object({
    commandType: z.literal("pause_all_sends"),
    actorId: z.string().uuid().optional(),
    payload: pauseAllSendsPayloadSchema
  }),
  z.object({
    commandType: z.literal("resume_all_sends"),
    actorId: z.string().uuid().optional(),
    payload: resumeAllSendsPayloadSchema
  }),
  z.object({
    commandType: z.literal("approve_draft_for_send"),
    actorId: z.string().uuid().optional(),
    payload: approveDraftForSendPayloadSchema
  }),
  z.object({
    commandType: z.literal("attach_inbound_to_thread"),
    actorId: z.string().uuid().optional(),
    payload: attachInboundToThreadPayloadSchema
  }),
  z.object({
    commandType: z.literal("merge_threads"),
    actorId: z.string().uuid().optional(),
    payload: mergeThreadsPayloadSchema
  }),
  z.object({
    commandType: z.literal("suppress_contact"),
    actorId: z.string().uuid().optional(),
    payload: suppressContactPayloadSchema
  }),
  z.object({
    commandType: z.literal("clear_suppression"),
    actorId: z.string().uuid().optional(),
    payload: clearSuppressionPayloadSchema
  }),
  z.object({
    commandType: z.literal("resolve_policy_state"),
    actorId: z.string().uuid().optional(),
    payload: resolvePolicyStatePayloadSchema
  }),
  z.object({
    commandType: z.literal("create_draft"),
    actorId: z.string().uuid().optional(),
    payload: createDraftPayloadSchema
  }),
  z.object({
    commandType: z.literal("request_manual_edit_save"),
    actorId: z.string().uuid().optional(),
    payload: requestManualEditSavePayloadSchema
  }),
  z.object({
    commandType: z.literal("mark_claim_resolved"),
    actorId: z.string().uuid().optional(),
    payload: markClaimResolvedPayloadSchema
  }),
  z.object({
    commandType: z.literal("discard_draft"),
    actorId: z.string().uuid().optional(),
    payload: discardDraftPayloadSchema
  }),
  z.object({
    commandType: z.literal("refresh_research_snapshot"),
    actorId: z.string().uuid().optional(),
    payload: refreshResearchSnapshotPayloadSchema
  }),
  z.object({
    commandType: z.literal("generate_draft"),
    actorId: z.string().uuid().optional(),
    payload: generateDraftPayloadSchema
  }),
  z.object({
    commandType: z.literal("generate_warm_draft"),
    actorId: z.string().uuid().optional(),
    payload: generateWarmDraftPayloadSchema
  }),
  z.object({
    commandType: z.literal("request_ai_revise"),
    actorId: z.string().uuid().optional(),
    payload: requestAiRevisePayloadSchema
  }),
  z.object({
    commandType: z.literal("request_research_more"),
    actorId: z.string().uuid().optional(),
    payload: requestResearchMorePayloadSchema
  }),
  z.object({
    commandType: z.literal("record_draft_feedback"),
    actorId: z.string().uuid().optional(),
    payload: recordDraftFeedbackPayloadSchema
  }),
  z.object({
    commandType: z.literal("recompute_quality_score"),
    actorId: z.string().uuid().optional(),
    payload: recomputeQualityScorePayloadSchema
  }),
  z.object({
    commandType: z.literal("set_primary_contact"),
    actorId: z.string().uuid().optional(),
    payload: setPrimaryContactPayloadSchema
  }),
  z.object({
    commandType: z.literal("approve_contact_candidate"),
    actorId: z.string().uuid().optional(),
    payload: approveContactCandidatePayloadSchema
  }),
  z.object({
    commandType: z.literal("reject_contact_candidate"),
    actorId: z.string().uuid().optional(),
    payload: rejectContactCandidatePayloadSchema
  }),
  z.object({
    commandType: z.literal("run_campaign_discovery"),
    actorId: z.string().uuid().optional(),
    payload: runCampaignDiscoveryPayloadSchema
  }),
  z.object({
    commandType: z.literal("accept_discovery_candidate"),
    actorId: z.string().uuid().optional(),
    payload: acceptDiscoveryCandidatePayloadSchema
  }),
  z.object({
    commandType: z.literal("reject_discovery_candidate"),
    actorId: z.string().uuid().optional(),
    payload: rejectDiscoveryCandidatePayloadSchema
  })
]);

export function buildAttachInboundToThreadIdempotencyKey(
  inboundMessageId: string,
  threadTarget: string,
  stateVersion: Date
): string {
  return `attach_inbound:${inboundMessageId}:${threadTarget}:${stateVersion.toISOString()}:v1`;
}

export function buildMergeThreadsIdempotencyKey(
  primaryThreadId: string,
  secondaryThreadId: string,
  reasonHash: string
): string {
  return `merge_threads:${primaryThreadId}:${secondaryThreadId}:${reasonHash}:v1`;
}

export function buildWorkItemActionIdempotencyKey(
  workItemId: string,
  action: WorkItemAction,
  stateVersion: Date
): string {
  return `work_item:${workItemId}:${action}:${stateVersion.toISOString()}:v1`;
}

export const workItemActionRequestSchema = z.object({
  workItemId: z.string().uuid(),
  action: z.enum(workItemActions),
  actorId: z.string().uuid().optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  snoozeMinutes: z.coerce.number().int().min(5).max(60 * 24 * 30).optional()
});

export type CampaignStatus = (typeof campaignStatuses)[number];
export type WebhookEventStatus = (typeof webhookEventStatuses)[number];
export type CommandSource = (typeof commandSources)[number];
export type CommandStatus = (typeof commandStatuses)[number];
export type OperatorCommandType = (typeof operatorCommandTypes)[number];
export type JobType = (typeof jobTypes)[number];
export type JobStatus = (typeof jobStatuses)[number];
export type EventType = (typeof eventTypes)[number];
export type AgentTokenUsage = z.infer<typeof agentTokenUsageSchema>;
export type WorkItemAction = (typeof workItemActions)[number];
export type OutboundMessageStatus = (typeof outboundMessageStatuses)[number];
export type SuppressionReason = (typeof suppressionReasons)[number];
export type StartCampaignPayload = z.infer<typeof startCampaignPayloadSchema>;
export type UpdateCampaignScopePayload = z.infer<typeof updateCampaignScopePayloadSchema>;
export type PauseAllSendsPayload = z.infer<typeof pauseAllSendsPayloadSchema>;
export type ResumeAllSendsPayload = z.infer<typeof resumeAllSendsPayloadSchema>;
export type ApproveDraftForSendPayload = z.infer<typeof approveDraftForSendPayloadSchema>;
export type AttachInboundToThreadPayload = z.infer<typeof attachInboundToThreadPayloadSchema>;
export type MergeThreadsPayload = z.infer<typeof mergeThreadsPayloadSchema>;
export type CreateDraftPayload = z.infer<typeof createDraftPayloadSchema>;
export type RequestManualEditSavePayload = z.infer<typeof requestManualEditSavePayloadSchema>;
export type MarkClaimResolvedPayload = z.infer<typeof markClaimResolvedPayloadSchema>;
export type DiscardDraftPayload = z.infer<typeof discardDraftPayloadSchema>;
export type SuppressContactPayload = z.infer<typeof suppressContactPayloadSchema>;
export type ClearSuppressionPayload = z.infer<typeof clearSuppressionPayloadSchema>;
export type ResolvePolicyStatePayload = z.infer<typeof resolvePolicyStatePayloadSchema>;
export type RefreshResearchSnapshotPayload = z.infer<typeof refreshResearchSnapshotPayloadSchema>;
export type GenerateDraftPayload = z.infer<typeof generateDraftPayloadSchema>;
export type GenerateWarmDraftPayload = z.infer<typeof generateWarmDraftPayloadSchema>;
export type RequestAiRevisePayload = z.infer<typeof requestAiRevisePayloadSchema>;
export type RequestResearchMorePayload = z.infer<typeof requestResearchMorePayloadSchema>;
export type RecordDraftFeedbackPayload = z.infer<typeof recordDraftFeedbackPayloadSchema>;
export type RecomputeQualityScorePayload = z.infer<typeof recomputeQualityScorePayloadSchema>;
export type SetPrimaryContactPayload = z.infer<typeof setPrimaryContactPayloadSchema>;
export type ApproveContactCandidatePayload = z.infer<typeof approveContactCandidatePayloadSchema>;
export type RejectContactCandidatePayload = z.infer<typeof rejectContactCandidatePayloadSchema>;
export type RunCampaignDiscoveryPayload = z.infer<typeof runCampaignDiscoveryPayloadSchema>;
export type AcceptDiscoveryCandidatePayload = z.infer<typeof acceptDiscoveryCandidatePayloadSchema>;
export type RejectDiscoveryCandidatePayload = z.infer<typeof rejectDiscoveryCandidatePayloadSchema>;
export type CreateCommandRequest = z.infer<typeof createCommandRequestSchema>;
export type WorkItemActionRequest = z.infer<typeof workItemActionRequestSchema>;

// =============================================================================
// Timing advice (canonical §13 + §66.5386-5402)
// =============================================================================
//
// Sending is operator-controlled — the system never owns the schedule. It
// produces ADVISORY hints only (`evaluateTimingAdvice`). Per §13.723, cold
// sends use stricter recipient-local timing than warm replies; per §66.5386
// "uncertain recipient timezone" + "suboptimal recipient-local timing" are
// warning-level (operator confirms) but in MVP we surface as advisory until
// per-contact timezone is captured.

export const timingAdviceSeverities = ["ok", "advisory", "warn"] as const;
export type TimingAdviceSeverity = (typeof timingAdviceSeverities)[number];

export const timingAdviceReasonCodes = [
  "outside_business_hours_local",
  "outside_business_hours_utc_assumed",
  "uncertain_timezone",
  "weekend_send",
  "warm_continuation_low_sensitivity",
  "in_business_hours_local",
  "no_recipient_email"
] as const;
export type TimingAdviceReasonCode = (typeof timingAdviceReasonCodes)[number];

export type TimingAdviceResult = {
  severity: TimingAdviceSeverity;
  reasons: TimingAdviceReasonCode[];
  recipientTimezone: string | null;
  recipientLocalHour: number | null;
  isWeekend: boolean;
  message: string;
};

// TLD → IANA timezone heuristic. Only used as best-effort hint; the operator
// remains the source of truth. Unknown TLDs return null and the eval falls
// back to "uncertain_timezone" so the operator gets a clear signal that the
// hint is missing rather than wrong.
const tldTimezoneHints: Record<string, string> = {
  uk: "Europe/London",
  ie: "Europe/Dublin",
  de: "Europe/Berlin",
  fr: "Europe/Paris",
  es: "Europe/Madrid",
  it: "Europe/Rome",
  pt: "Europe/Lisbon",
  nl: "Europe/Amsterdam",
  be: "Europe/Brussels",
  ch: "Europe/Zurich",
  at: "Europe/Vienna",
  pl: "Europe/Warsaw",
  cz: "Europe/Prague",
  se: "Europe/Stockholm",
  no: "Europe/Oslo",
  dk: "Europe/Copenhagen",
  fi: "Europe/Helsinki",
  ru: "Europe/Moscow",
  ua: "Europe/Kyiv",
  tr: "Europe/Istanbul",
  il: "Asia/Jerusalem",
  ae: "Asia/Dubai",
  in: "Asia/Kolkata",
  cn: "Asia/Shanghai",
  jp: "Asia/Tokyo",
  kr: "Asia/Seoul",
  sg: "Asia/Singapore",
  hk: "Asia/Hong_Kong",
  au: "Australia/Sydney",
  nz: "Pacific/Auckland",
  br: "America/Sao_Paulo",
  ar: "America/Argentina/Buenos_Aires",
  mx: "America/Mexico_City",
  ca: "America/Toronto",
  us: "America/New_York"
};

export function inferRecipientTimezoneFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  const lastDot = domain.lastIndexOf(".");
  if (lastDot < 0) return null;
  const tld = domain.slice(lastDot + 1);
  return tldTimezoneHints[tld] ?? null;
}

// Returns the hour-of-day (0..23) for `now` rendered in `timezone`, or null
// if timezone is invalid. Uses Intl.DateTimeFormat — no third-party tz lib.
function getLocalHour(now: Date, timezone: string): number | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false
    });
    const hourStr = fmt.format(now);
    const hour = Number.parseInt(hourStr, 10);
    return Number.isFinite(hour) ? hour : null;
  } catch {
    return null;
  }
}

function getLocalWeekday(now: Date, timezone: string): number | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short"
    });
    const wd = fmt.format(now);
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  } catch {
    return null;
  }
}

export function evaluateTimingAdvice(input: {
  draftKind: "cold" | "warm";
  recipientEmail: string | null;
  now?: Date;
}): TimingAdviceResult {
  const now = input.now ?? new Date();
  if (!input.recipientEmail) {
    return {
      severity: "advisory",
      reasons: ["no_recipient_email"],
      recipientTimezone: null,
      recipientLocalHour: null,
      isWeekend: false,
      message: "No recipient email — link a contact to evaluate timing."
    };
  }

  const recipientTimezone = inferRecipientTimezoneFromEmail(input.recipientEmail);
  const reasons: TimingAdviceReasonCode[] = [];
  let severity: TimingAdviceSeverity = "ok";

  if (!recipientTimezone) {
    reasons.push("uncertain_timezone");
    // For warm replies, uncertain timezone is advisory (recipient just wrote
    // to us, so any "now-ish" reply is normal). For cold sends it's a clearer
    // warning per §13.723.
    severity = input.draftKind === "warm" ? "advisory" : "warn";
    const utcHour = now.getUTCHours();
    const utcWeekday = now.getUTCDay();
    const isWeekendUtc = utcWeekday === 0 || utcWeekday === 6;
    if (utcHour < 9 || utcHour >= 18 || isWeekendUtc) {
      reasons.push("outside_business_hours_utc_assumed");
    }
    return {
      severity,
      reasons,
      recipientTimezone: null,
      recipientLocalHour: utcHour,
      isWeekend: isWeekendUtc,
      message:
        input.draftKind === "warm"
          ? "Recipient timezone unknown — warm reply timing is less sensitive but operator should still confirm."
          : "Recipient timezone unknown — cold sends prefer recipient-local 9..17 weekdays. Confirm before sending."
    };
  }

  const localHour = getLocalHour(now, recipientTimezone);
  const localWeekday = getLocalWeekday(now, recipientTimezone);
  const isWeekend = localWeekday === 0 || localWeekday === 6;

  if (localHour === null) {
    return {
      severity: "advisory",
      reasons: ["uncertain_timezone"],
      recipientTimezone,
      recipientLocalHour: null,
      isWeekend: false,
      message: `Could not resolve local hour for ${recipientTimezone}.`
    };
  }

  if (input.draftKind === "warm") {
    // Warm replies: low timing sensitivity. Off-hours is informational only.
    if (localHour < 7 || localHour >= 22 || isWeekend) {
      reasons.push("outside_business_hours_local");
      if (isWeekend) reasons.push("weekend_send");
      return {
        severity: "advisory",
        reasons,
        recipientTimezone,
        recipientLocalHour: localHour,
        isWeekend,
        message: `Warm reply at recipient-local ${localHour}:00 (${recipientTimezone}). Off-hours but warm replies are low-sensitivity — fine to send.`
      };
    }
    reasons.push("in_business_hours_local", "warm_continuation_low_sensitivity");
    return {
      severity: "ok",
      reasons,
      recipientTimezone,
      recipientLocalHour: localHour,
      isWeekend,
      message: `Recipient-local ${localHour}:00 (${recipientTimezone}). Good warm-reply window.`
    };
  }

  // Cold draft: stricter rules per §13.723.
  if (isWeekend) {
    reasons.push("weekend_send", "outside_business_hours_local");
    return {
      severity: "warn",
      reasons,
      recipientTimezone,
      recipientLocalHour: localHour,
      isWeekend,
      message: `Cold send at recipient-local weekend (${recipientTimezone}). Wait for next business day.`
    };
  }
  if (localHour < 9 || localHour >= 17) {
    reasons.push("outside_business_hours_local");
    return {
      severity: "warn",
      reasons,
      recipientTimezone,
      recipientLocalHour: localHour,
      isWeekend,
      message: `Cold send at recipient-local ${localHour}:00 (${recipientTimezone}). Outside 9..17 — open rates drop. Confirm before sending.`
    };
  }
  reasons.push("in_business_hours_local");
  return {
    severity: "ok",
    reasons,
    recipientTimezone,
    recipientLocalHour: localHour,
    isWeekend,
    message: `Recipient-local ${localHour}:00 (${recipientTimezone}). Good cold-send window.`
  };
}

// =============================================================================
// Job retry policy (canonical §34)
// =============================================================================
//
// Retry policy must vary by job class and job type. Without per-type policy a
// single global rule produces the wrong tradeoffs:
//   - send_email (Class A) needs strict bounds — every retry is a real-world
//     side effect with reputation cost on ambiguity
//   - LLM / agent calls (Class B) tolerate more retries — providers 5xx/429
//     are common but most resolve within a few minutes
//   - internal jobs (Class C) tolerate moderate retries — DB contention /
//     advisory-lock churn benefits from a few attempts
//
// Per-type entries override class defaults. Handlers can throw
// `NonRetryableJobError` to short-circuit the retry loop on classified
// non-retryable failures (policy violation, invalid payload, hard rejection).

export const jobClasses = ["A_outward", "B_external_compute", "C_internal"] as const;
export type JobClass = (typeof jobClasses)[number];

export const finalFailureSeverities = ["low", "medium", "high"] as const;
export type FinalFailureSeverity = (typeof finalFailureSeverities)[number];

export type JobRetryPolicy = {
  jobClass: JobClass;
  maxAttempts: number;
  baseBackoffSeconds: number;
  maxBackoffSeconds: number;
  finalFailureSeverity: FinalFailureSeverity;
  // Ambiguous outcomes (e.g. send timeout where the provider may or may not
  // have actually sent) MUST go to manual reconciliation, not blind retry.
  // Currently informational — `transitionOutboundMessageStatus` already
  // creates the reconciliation work item.
  requiresManualReconcileOnAmbiguity: boolean;
};

const classDefaults: Record<JobClass, JobRetryPolicy> = {
  A_outward: {
    jobClass: "A_outward",
    maxAttempts: 3,
    baseBackoffSeconds: 30,
    maxBackoffSeconds: 600,
    finalFailureSeverity: "high",
    requiresManualReconcileOnAmbiguity: true
  },
  B_external_compute: {
    jobClass: "B_external_compute",
    maxAttempts: 5,
    baseBackoffSeconds: 10,
    maxBackoffSeconds: 300,
    finalFailureSeverity: "medium",
    requiresManualReconcileOnAmbiguity: false
  },
  C_internal: {
    jobClass: "C_internal",
    maxAttempts: 5,
    baseBackoffSeconds: 5,
    maxBackoffSeconds: 120,
    finalFailureSeverity: "low",
    requiresManualReconcileOnAmbiguity: false
  }
};

const jobTypeToClass: Record<string, JobClass> = {
  "job.send_email": "A_outward",
  "job.send_telegram_notification": "A_outward",
  "job.refresh_research_snapshot": "B_external_compute",
  "job.research_more": "B_external_compute",
  "job.generate_cold_draft": "B_external_compute",
  "job.generate_warm_draft": "B_external_compute",
  "job.revise_draft": "B_external_compute",
  "job.revalidate_draft_claims": "B_external_compute",
  "job.match_thread": "C_internal",
  "job.classify_reply": "C_internal",
  "job.recompute_work_items": "C_internal",
  "job.refresh_thread_summary": "C_internal",
  "job.process_webhook_event": "C_internal",
  "job.index_rag_document": "B_external_compute",
  "job.cron_recover_stale_jobs": "C_internal",
  "job.cron_worker_heartbeat_watchdog": "C_internal",
  "job.cron_queue_depth_watchdog": "C_internal",
  "job.cron_rotate_event_log": "C_internal",
  "job.cron_rollup_agent_costs": "C_internal",
  "job.resurface_policy_states": "C_internal",
  "job.run_campaign_discovery": "B_external_compute"
};

const jobTypeOverrides: Record<string, Partial<JobRetryPolicy>> = {
  // Telegram is bounded but more permissive than email per §34.2298-2300.
  "job.send_telegram_notification": { maxAttempts: 5 }
};

export function getJobRetryPolicy(jobType: string): JobRetryPolicy {
  const cls = jobTypeToClass[jobType] ?? "C_internal";
  const base = classDefaults[cls];
  const override = jobTypeOverrides[jobType] ?? {};
  return { ...base, ...override };
}

// Exponential backoff with jitter cap. Jitter intentionally omitted for
// determinism in tests; production behavior is acceptable since the lease
// model already serializes via `available_at`.
export function computeJobBackoffSeconds(jobType: string, attempts: number): number {
  const policy = getJobRetryPolicy(jobType);
  const exp = Math.max(0, attempts - 1);
  const raw = policy.baseBackoffSeconds * 2 ** exp;
  return Math.min(policy.maxBackoffSeconds, raw);
}

export class NonRetryableJobError extends Error {
  override readonly name = "NonRetryableJobError";
  readonly errorClass: string;
  constructor(message: string, errorClass = "non_retryable") {
    super(message);
    this.errorClass = errorClass;
  }
}

export function isNonRetryableJobError(error: unknown): error is NonRetryableJobError {
  return error instanceof NonRetryableJobError
    || (typeof error === "object"
      && error !== null
      && (error as { name?: unknown }).name === "NonRetryableJobError");
}
