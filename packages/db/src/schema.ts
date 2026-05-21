import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  }
});

export const campaignStatus = pgEnum("campaign_status", [
  "drafting_scope",
  "active",
  "paused",
  "closed"
]);

export const webhookEventStatus = pgEnum("webhook_event_status", [
  "received",
  "duplicate_ignored",
  "queued_for_processing",
  "processing",
  "processed",
  "processing_failed",
  "dead_lettered"
]);

export const commandSource = pgEnum("command_source", ["operator", "system", "telegram"]);

export const commandStatus = pgEnum("command_status", [
  "accepted",
  "rejected",
  "queued",
  "executing",
  "completed",
  "failed",
  "deduplicated"
]);

export const jobStatus = pgEnum("job_status", [
  "queued",
  "leased",
  "running",
  "succeeded",
  "failed",
  "dead_lettered",
  "cancelled"
]);

export const jobRunStatus = pgEnum("job_run_status", ["running", "succeeded", "failed"]);

export const agentRunStatus = pgEnum("agent_run_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "needs_repair",
  "blocked"
]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: campaignStatus("status").notNull().default("drafting_scope"),
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  offerSummary: text("offer_summary"),
  desiredCta: text("desired_cta"),
  targetSegments: jsonb("target_segments").$type<string[]>().notNull().default([]),
  forbiddenClaims: text("forbidden_claims").array().notNull().default(sql`'{}'::text[]`),
  senderIdentityId: uuid("sender_identity_id"),
  policyProfileId: uuid("policy_profile_id"),
  operatorNotes: text("operator_notes"),
  discoverySourceHints: jsonb("discovery_source_hints").$type<string[]>().notNull().default([]),
  discoveryExclusions: text("discovery_exclusions").array().notNull().default(sql`'{}'::text[]`),
  allowedRegions: text("allowed_regions").array().notNull().default(sql`'{}'::text[]`),
  maxOrganizationsToDiscover: integer("max_organizations_to_discover").notNull().default(25),
  maxConcurrentEnrichments: integer("max_concurrent_enrichments").notNull().default(3),
  maxConcurrentDrafts: integer("max_concurrent_drafts").notNull().default(5),
  maxOpenDraftReviews: integer("max_open_draft_reviews").notNull().default(25),
  cooldownBetweenDiscoverySeconds: integer("cooldown_between_discovery_seconds").notNull().default(3600),
  discoveryScopeVersion: integer("discovery_scope_version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => ({
  statusDiscoveryScopeIdx: index("campaigns_status_discovery_scope_idx").on(
    table.status,
    table.discoveryScopeVersion
  )
}));

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  domain: text("domain"),
  countryCode: text("country_code"),
  primaryContactId: uuid("primary_contact_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => ({
  domainIdx: index("organizations_domain_idx").on(table.domain)
}));

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  email: text("email").notNull(),
  fullName: text("full_name"),
  roleTitle: text("role_title"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => ({
  emailIdx: uniqueIndex("contacts_email_idx").on(table.email)
}));

export const outreachRecords = pgTable("outreach_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
  organizationId: uuid("organization_id").references(() => organizations.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  status: text("status").notNull().default("planned"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const threads = pgTable("threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  organizationId: uuid("organization_id").references(() => organizations.id),
  status: text("status").notNull().default("open"),
  providerThreadKey: text("provider_thread_key"),
  mergedIntoThreadId: uuid("merged_into_thread_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const threadParticipants = pgTable("thread_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => threads.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  email: text("email").notNull(),
  role: text("role").notNull().default("recipient"),
  createdAt: createdAt()
});

export const drafts = pgTable("drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  threadId: uuid("thread_id").references(() => threads.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  version: integer("version").notNull().default(1),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("draft"),
  // `cold` (campaign outreach) | `warm` (in-thread reply). Drives policy
  // bucket separation per canonical §12.710-713 + analytics. Defaults to
  // `cold` for backward compatibility with existing rows.
  kind: text("kind").notNull().default("cold"),
  claimsValidatedVersion: integer("claims_validated_version"),
  // Rule-based quality score (canonical §15) — 0..100, NULL = never computed.
  // Recomputed in-tx after every signal-bearing mutation (create / edit /
  // revise / approve / feedback / claim revalidation). `qualityScoreReasons`
  // stores the reason-tag breakdown so the UI can show *why* the number is
  // what it is, per canonical §15 ("Quality score should store reason tags,
  // not just a number").
  qualityScore: integer("quality_score"),
  qualityScoreBand: text("quality_score_band"),
  qualityScoreReasons: jsonb("quality_score_reasons").$type<string[]>().notNull().default([]),
  // Autosend readiness label (canonical §15.842-855) — annotation only in MVP,
  // does NOT bypass operator approval, does NOT trigger sends. Recomputed in
  // the same pass as `qualityScore`.
  autosendReadiness: text("autosend_readiness"),
  scoresComputedAt: timestamp("scores_computed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

// Append-only audit trail of every draft body the operator or agent has
// produced. `drafts` row is the "current head pointer" (its `version` field
// matches the latest row here for the same `draftId`); each prior version is
// preserved here for review / learning. Per canonical design §60.4509-4520
// every state transition (operator edit, AI revise, AI generation) writes a
// new row, never overwrites an existing one.
export const draftVersions = pgTable("draft_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftId: uuid("draft_id").notNull().references(() => drafts.id),
  version: integer("version").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  bodyHash: text("body_hash").notNull(),
  // `claims_validated_version` snapshotted at write time so the history row
  // is self-describing (the live `drafts.claims_validated_version` may have
  // moved past this version since the row was written).
  claimsValidatedVersion: integer("claims_validated_version"),
  // Where this version came from. Drives badge color in the UI timeline +
  // future learning-corpus routing (operator_edited rows after agent_revised
  // rows are negative-feedback learning signal per canonical §60).
  source: text("source").notNull(),
  changeNotes: text("change_notes"),
  // The agent_run that produced this version (set for agent_generated /
  // agent_revised; null for operator_created / operator_edited).
  agentRunId: uuid("agent_run_id").references(() => agentRuns.id),
  // Deterministic edit severity per canonical §15.800-822. Set only on
  // `operator_edited` rows (NULL for everything else); the classifier diffs
  // (prevSubject, prevBody) → (newSubject, newBody) and produces one of
  // `none|minor|moderate|major|rewrite`. `editSeveritySignals` records which
  // sub-signals fired so the UI / learning pipeline can trace the label.
  editSeverity: text("edit_severity"),
  editSeveritySignals: jsonb("edit_severity_signals").$type<string[]>().notNull().default([]),
  // Learning-corpus routing label (canonical §62.5937-5983). NULL = unrouted
  // (legacy rows). One of `positive | negative | neutral`. Reason tags in
  // `corpusLabelReasons` explain why the router picked the label so Phase 6
  // RAG ranking and the UI can both trace the decision.
  corpusLabel: text("corpus_label"),
  corpusLabelReasons: jsonb("corpus_label_reasons").$type<string[]>().notNull().default([]),
  createdAt: createdAt()
}, (table) => ({
  draftVersionUq: uniqueIndex("draft_versions_draft_id_version_idx").on(
    table.draftId,
    table.version
  )
}));

// Append-only learning corpus per canonical §62. Every operator action that
// expresses a judgment about a draft (manual edit, AI revise request,
// approval, discard, standalone note) writes one row here, attributed to the
// specific `draft_version` the operator was looking at. Downstream learning
// pipelines route positive vs negative signals from `kind` + `tags`.
export const draftFeedback = pgTable("draft_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftId: uuid("draft_id").notNull().references(() => drafts.id),
  // Snapshotted at write time so the feedback is permanently bound to the
  // version the operator judged, not the head pointer that may have moved.
  draftVersion: integer("draft_version").notNull(),
  // `manual_edit` | `ai_revise` | `approve` | `discard` | `explicit`. Free
  // text for forward compatibility; zod taxonomy in shared/.
  kind: text("kind").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  note: text("note"),
  actorId: text("actor_id"),
  sourceCommandId: uuid("source_command_id").references(() => commands.id),
  // Learning-corpus routing label (canonical §62.5937-5983). Computed at write
  // time from kind + tags; never null for new rows but kept nullable for
  // legacy/back-compat. Reason tags trace the router decision.
  corpusLabel: text("corpus_label"),
  corpusLabelReasons: jsonb("corpus_label_reasons").$type<string[]>().notNull().default([]),
  createdAt: createdAt()
}, (table) => ({
  draftIdx: index("draft_feedback_draft_id_idx").on(table.draftId, table.createdAt),
  kindIdx: index("draft_feedback_kind_idx").on(table.kind, table.createdAt)
}));

export const outboundMessages = pgTable("outbound_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftId: uuid("draft_id").references(() => drafts.id),
  threadId: uuid("thread_id").references(() => threads.id),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  recipientEmail: text("recipient_email").notNull(),
  provider: text("provider").notNull().default("resend"),
  providerMessageId: text("provider_message_id"),
  rfc822MessageId: text("rfc822_message_id"),
  status: text("status").notNull().default("send_requested"),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadSnapshotJson: jsonb("payload_snapshot_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => ({
  idempotencyIdx: uniqueIndex("outbound_messages_idempotency_idx").on(table.idempotencyKey)
}));

export const inboundMessages = pgTable("inbound_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  webhookEventId: uuid("webhook_event_id"),
  threadId: uuid("thread_id").references(() => threads.id),
  fromEmail: text("from_email").notNull(),
  subject: text("subject"),
  rawText: text("raw_text"),
  rfc822MessageId: text("rfc822_message_id"),
  inReplyTo: text("in_reply_to"),
  referencesJson: jsonb("references_json").$type<string[]>().notNull().default([]),
  attachmentsJson: jsonb("attachments_json").$type<Array<{
    filename: string | null;
    contentType: string | null;
    size: number | null;
    contentId: string | null;
    providerAttachmentId: string | null;
  }>>().notNull().default([]),
  replyClass: text("reply_class"),
  replyClassConfidence: text("reply_class_confidence"),
  classifiedAt: timestamp("classified_at", { withTimezone: true }),
  classifyAgentRunId: uuid("classify_agent_run_id").references(() => agentRuns.id),
  createdAt: createdAt()
}, (table) => ({
  threadClassIdx: index("inbound_messages_thread_class_idx")
    .on(table.threadId, table.replyClass)
    .where(sql`${table.threadId} IS NOT NULL`),
  unclassifiedIdx: index("inbound_messages_unclassified_idx")
    .on(table.threadId, table.createdAt)
    .where(sql`${table.replyClass} IS NULL AND ${table.threadId} IS NOT NULL`)
}));

export const suppressionEntries = pgTable("suppression_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  reason: text("reason").notNull(),
  source: text("source").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => ({
  activeEmailIdx: index("suppression_entries_active_email_idx").on(table.email, table.active)
}));

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("resend"),
  providerEventId: text("provider_event_id"),
  eventType: text("event_type").notNull(),
  recipientEmail: text("recipient_email"),
  status: webhookEventStatus("status").notNull().default("received"),
  dedupeKey: text("dedupe_key").notNull(),
  rawHeadersJson: jsonb("raw_headers_json").$type<Record<string, unknown>>().notNull().default({}),
  rawBodyJson: jsonb("raw_body_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => ({
  dedupeIdx: uniqueIndex("webhook_events_dedupe_idx").on(table.dedupeKey),
  recipientStatusIdx: index("webhook_events_recipient_status_idx").on(table.recipientEmail, table.status)
}));

export const webhookEventNonces = pgTable("webhook_event_nonces", {
  svixId: text("svix_id").primaryKey(),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  seenAtIdx: index("webhook_event_nonces_seen_at_idx").on(table.seenAt)
}));

export const telegramOperators = pgTable("telegram_operators", {
  telegramId: bigint("telegram_id", { mode: "number" }).primaryKey(),
  // There is no first-class operators table yet; this stores the UUID used by
  // command actor_id fields so Telegram commands stay on the canonical path.
  operatorId: uuid("operator_id").notNull(),
  active: boolean("active").notNull().default(true),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: updatedAt()
}, (table) => ({
  activeIdx: index("telegram_operators_active_idx").on(table.active, table.addedAt)
}));

export const commands = pgTable("commands", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: commandSource("source").notNull(),
  commandType: text("command_type").notNull(),
  status: commandStatus("status").notNull().default("accepted"),
  actorId: uuid("actor_id"),
  targetEntityType: text("target_entity_type"),
  targetEntityId: uuid("target_entity_id"),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: text("idempotency_key").notNull(),
  correlationId: uuid("correlation_id").notNull(),
  parentCommandId: uuid("parent_command_id"),
  causationEventId: uuid("causation_event_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => ({
  idempotencyIdx: uniqueIndex("commands_idempotency_idx").on(table.idempotencyKey),
  statusIdx: index("commands_status_idx").on(table.status)
}));

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobType: text("job_type").notNull(),
  status: jobStatus("status").notNull().default("queued"),
  commandId: uuid("command_id").references(() => commands.id),
  targetEntityType: text("target_entity_type"),
  targetEntityId: uuid("target_entity_id"),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  workerPool: text("worker_pool").notNull().default("background"),
  priority: integer("priority").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leasedBy: text("leased_by"),
  leasedUntil: timestamp("leased_until", { withTimezone: true }),
  concurrencyKey: text("concurrency_key"),
  correlationId: uuid("correlation_id").notNull(),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => ({
  leaseIdx: index("jobs_lease_idx").on(table.status, table.availableAt, table.priority),
  workerPoolStatusIdx: index("jobs_worker_pool_status_idx").on(table.workerPool, table.status, table.availableAt, table.priority),
  concurrencyIdx: index("jobs_concurrency_idx").on(table.concurrencyKey)
}));

export const jobRuns = pgTable("job_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => jobs.id),
  status: jobRunStatus("status").notNull().default("running"),
  workerId: text("worker_id").notNull(),
  attempt: integer("attempt").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  errorMessage: text("error_message")
});

export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  status: text("status").notNull().default("running"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({})
}, (table) => ({
  lastSeenIdx: index("worker_heartbeats_last_seen_idx").on(table.lastSeenAt)
}));

export const eventLog = pgTable("event_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  commandId: uuid("command_id").references(() => commands.id),
  jobId: uuid("job_id").references(() => jobs.id),
  correlationId: uuid("correlation_id").notNull(),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt()
}, (table) => ({
  entityIdx: index("event_log_entity_idx").on(table.entityType, table.entityId),
  correlationIdx: index("event_log_correlation_idx").on(table.correlationId)
}));

export const eventLogArchive = pgTable("event_log_archive", {
  id: uuid("id").primaryKey(),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  commandId: uuid("command_id"),
  jobId: uuid("job_id"),
  correlationId: uuid("correlation_id").notNull(),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  entityIdx: index("event_log_archive_entity_idx").on(table.entityType, table.entityId),
  correlationIdx: index("event_log_archive_correlation_idx").on(table.correlationId),
  createdAtIdx: index("event_log_archive_created_at_idx").on(table.createdAt)
}));

export const systemState = pgTable("system_state", {
  key: text("key").primaryKey(),
  valueJson: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  updatedAt: updatedAt()
}, (table) => ({
  expiresAtIdx: index("system_state_expires_at_idx").on(table.expiresAt)
}));

export const policyStateEntries = pgTable("policy_state_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  scopeType: text("scope_type").notNull(),
  scopeId: uuid("scope_id"),
  scopeKey: text("scope_key"),
  stateType: text("state_type").notNull(),
  status: text("status").notNull().default("active"),
  reasonCode: text("reason_code").notNull(),
  reasonText: text("reason_text"),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdByType: text("created_by_type").notNull().default("system"),
  createdById: uuid("created_by_id"),
  sourceEventId: uuid("source_event_id").references(() => eventLog.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByOperatorId: uuid("resolved_by_operator_id")
}, (table) => ({
  scopeIdx: index("policy_state_entries_scope_idx").on(table.scopeType, table.scopeId, table.scopeKey, table.status)
}));

export const workItems = pgTable("work_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  status: text("status").notNull().default("open"),
  priority: integer("priority").notNull().default(0),
  sourceEntityType: text("source_entity_type").notNull(),
  sourceEntityId: uuid("source_entity_id").notNull(),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  organizationId: uuid("organization_id").references(() => organizations.id),
  threadId: uuid("thread_id").references(() => threads.id),
  draftId: uuid("draft_id").references(() => drafts.id),
  inboundMessageId: uuid("inbound_message_id").references(() => inboundMessages.id),
  outboundMessageId: uuid("outbound_message_id").references(() => outboundMessages.id),
  title: text("title").notNull(),
  summary: text("summary"),
  reasonCode: text("reason_code").notNull(),
  actionLabel: text("action_label"),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByOperatorId: uuid("resolved_by_operator_id"),
  dedupeKey: text("dedupe_key").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => ({
  dedupeIdx: uniqueIndex("work_items_dedupe_idx").on(table.dedupeKey),
  statusPriorityIdx: index("work_items_status_priority_idx").on(table.status, table.priority, table.availableAt),
  typeStatusIdx: index("work_items_type_status_idx").on(table.type, table.status)
}));

export const inboxViews = pgTable("inbox_views", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: text("operator_id").notNull(),
  name: text("name").notNull(),
  filterJson: jsonb("filter_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => ({
  operatorIdx: index("inbox_views_operator_idx").on(table.operatorId, table.name),
  operatorNameUidx: uniqueIndex("inbox_views_operator_name_uidx").on(table.operatorId, table.name)
}));

export const idempotencyRegistry = pgTable("idempotency_registry", {
  id: uuid("id").primaryKey().defaultRandom(),
  idempotencyKey: text("idempotency_key").notNull(),
  scope: text("scope").notNull(),
  operation: text("operation").notNull(),
  status: text("status").notNull().default("started"),
  requestHash: text("request_hash"),
  resultJson: jsonb("result_json").$type<Record<string, unknown>>().notNull().default({}),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => ({
  keyIdx: uniqueIndex("idempotency_registry_key_idx").on(table.idempotencyKey)
}));

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runtime: text("runtime").notNull().default("adk"),
  stage: text("stage").notNull(),
  status: agentRunStatus("status").notNull().default("queued"),
  jobId: uuid("job_id").references(() => jobs.id),
  inputSnapshotJson: jsonb("input_snapshot_json").$type<Record<string, unknown>>().notNull().default({}),
  tokenUsageJson: jsonb("token_usage_json").$type<Record<string, unknown>>().notNull().default({}),
  outputJson: jsonb("output_json").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const agentCostDaily = pgTable("agent_cost_daily", {
  id: uuid("id").primaryKey().defaultRandom(),
  usageDay: timestamp("usage_day", { withTimezone: true }).notNull(),
  stage: text("stage").notNull(),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedUsd: numeric("estimated_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  runCount: integer("run_count").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => ({
  usageDayIdx: index("agent_cost_daily_usage_day_idx").on(table.usageDay),
  stageIdx: index("agent_cost_daily_stage_idx").on(table.stage, table.usageDay),
  campaignIdx: index("agent_cost_daily_campaign_idx").on(table.campaignId, table.usageDay)
}));

export const agentRunEvents = pgTable("agent_run_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentRunId: uuid("agent_run_id").notNull().references(() => agentRuns.id),
  eventType: text("event_type").notNull(),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt()
});

export const agentRunArtifacts = pgTable("agent_run_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentRunId: uuid("agent_run_id").notNull().references(() => agentRuns.id),
  artifactType: text("artifact_type").notNull(),
  uri: text("uri"),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt()
});

export const researchSnapshots = pgTable("research_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  snapshotVersion: integer("snapshot_version").notNull().default(1),
  status: text("status").notNull().default("draft"),
  questionsJson: jsonb("questions_json").$type<string[]>().notNull().default([]),
  createdAt: createdAt()
}, (table) => ({
  orgVersionUidx: uniqueIndex("research_snapshots_org_version_uidx").on(
    table.organizationId,
    table.snapshotVersion
  )
}));

export const researchFacts = pgTable("research_facts", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotId: uuid("snapshot_id").notNull().references(() => researchSnapshots.id),
  factText: text("fact_text").notNull(),
  status: text("status").notNull().default("proposed"),
  confidence: integer("confidence").notNull().default(0),
  safeForCopy: boolean("safe_for_copy").notNull().default(false),
  createdAt: createdAt()
});

export const researchEvidence = pgTable("research_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceUrl: text("source_url"),
  sourceType: text("source_type").notNull(),
  quoteText: text("quote_text"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow()
});

export const researchFactEvidence = pgTable("research_fact_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  researchFactId: uuid("research_fact_id").notNull().references(() => researchFacts.id),
  researchEvidenceId: uuid("research_evidence_id").notNull().references(() => researchEvidence.id),
  supportType: text("support_type").notNull()
});

export const researchContactCandidates = pgTable("research_contact_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  email: text("email"),
  fullName: text("full_name"),
  confidence: integer("confidence").notNull().default(0),
  // Review lifecycle: pending (agent emitted, awaiting operator) →
  // approved (operator accepted, conversion to contacts row queued) →
  // converted (contacts row created, candidate is now historical) OR
  // rejected (operator declined; can be re-surfaced by a later research run).
  // CHECK constraint enforced in migration 0016.
  status: text("status").notNull().default("pending"),
  role: text("role"),
  // Where the agent found the candidate (e.g., "website_team_page",
  // "linkedin_search", "press_release"). Free-form by design — the agent
  // taxonomy evolves faster than a CHECK constraint would survive.
  source: text("source"),
  evidenceUrl: text("evidence_url"),
  sourceRefs: jsonb("source_refs").$type<Array<{ url: string; title?: string; snippet?: string }>>().notNull().default([]),
  agentRunId: uuid("agent_run_id").references(() => agentRuns.id),
  // Set when status='converted'; back-pointer to the contacts row so the
  // candidate's audit trail survives the conversion.
  convertedContactId: uuid("converted_contact_id").references(() => contacts.id),
  notes: text("notes"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => ({
  orgEmailActiveIdx: uniqueIndex("research_contact_candidates_org_email_active_idx")
    .on(table.organizationId, sql`lower(${table.email})`)
    .where(sql`${table.email} is not null and ${table.status} in ('pending','approved')`),
  orgStatusIdx: index("research_contact_candidates_org_status_idx")
    .on(table.organizationId, table.status, table.createdAt),
  orgNameActiveIdx: index("research_contact_candidates_org_name_active_idx")
    .on(table.organizationId, sql`lower(${table.fullName})`)
    .where(sql`${table.email} is null and ${table.status} in ('pending','approved')`),
  lastSeenIdx: index("research_contact_candidates_last_seen_idx").on(table.lastSeenAt)
}));

// Prospect discovery (Tickets 3.1/3.2, canonical §67). One row per
// candidate organization the `campaign_discovery` ADK stage proposed for
// a campaign brief. The worker validates → dedupes → policy-gates →
// inserts; operator accepts/rejects from the dashboard. Accepted rows
// materialize an `organizations` row and trigger `job.refresh_research_snapshot`.
// Status taxonomy + dedupe rubric: see migration 0018 + canonical §67.
export const discoveryCandidates = pgTable("discovery_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  proposedName: text("proposed_name").notNull(),
  domain: text("domain"),
  websiteUrl: text("website_url"),
  countryCode: text("country_code"),
  region: text("region"),
  // Anti-hallucination grounding: array of {url, title, snippet} the agent
  // cited per proposal. Worker rejects proposals with empty source_refs.
  sourceRefs: jsonb("source_refs").$type<Array<{ url: string; title?: string; snippet?: string }>>().notNull().default([]),
  fitRationale: text("fit_rationale"),
  confidence: text("confidence"),
  // Result of the dedupe pass against existing organizations: `none` =
  // novel, `strong` = auto-linked (status flips to `duplicate`), `medium`
  // / `weak` = ambiguity, status flips to `needs_review`.
  dedupeResult: text("dedupe_result").notNull().default("none"),
  matchedOrganizationId: uuid("matched_organization_id")
    .references(() => organizations.id, { onDelete: "set null" }),
  status: text("status").notNull().default("proposed"),
  rejectionReason: text("rejection_reason"),
  rejectionReasonCode: text("rejection_reason_code"),
  agentRunId: uuid("agent_run_id").references(() => agentRuns.id),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => ({
  campaignStatusIdx: index("discovery_candidates_campaign_status_idx")
    .on(table.campaignId, table.status, table.createdAt),
  activeDomainIdx: uniqueIndex("discovery_candidates_active_domain_idx")
    .on(table.campaignId, sql`lower(${table.domain})`)
    .where(sql`${table.domain} is not null and ${table.status} in ('proposed','accepted','queued_for_enrichment','enriched','needs_review','duplicate')`),
  activeNameNoDomainIdx: uniqueIndex("discovery_candidates_active_name_no_domain_idx")
    .on(table.campaignId, sql`lower(${table.proposedName})`)
    .where(sql`${table.domain} is null and ${table.status} in ('proposed','accepted','queued_for_enrichment','enriched','needs_review','duplicate')`)
}));

export const draftClaims = pgTable("draft_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftId: uuid("draft_id").notNull().references(() => drafts.id),
  claimText: text("claim_text").notNull(),
  safety: text("safety").notNull().default("needs_review"),
  createdAt: createdAt()
});

export const draftClaimFactRefs = pgTable("draft_claim_fact_refs", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftClaimId: uuid("draft_claim_id").notNull().references(() => draftClaims.id),
  researchFactId: uuid("research_fact_id").notNull().references(() => researchFacts.id),
  supportType: text("support_type").notNull(),
  createdAt: createdAt()
});

export const operatorFeedback = pgTable("operator_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  feedbackType: text("feedback_type").notNull(),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  organizationId: uuid("organization_id").references(() => organizations.id),
  draftId: uuid("draft_id").references(() => drafts.id),
  operatorId: uuid("operator_id"),
  note: text("note"),
  createdAt: createdAt()
});

export const ragDocuments = pgTable("rag_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceType: text("source_type").notNull(),
  sourceEntityType: text("source_entity_type"),
  sourceEntityId: uuid("source_entity_id"),
  organizationId: uuid("organization_id").references(() => organizations.id),
  corpusLabel: text("corpus_label"),
  qualityScore: integer("quality_score"),
  summary: text("summary"),
  indexedVersion: integer("indexed_version").notNull().default(0),
  metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
  title: text("title").notNull(),
  body: text("body").notNull(),
  eligibleForRetrieval: boolean("eligible_for_retrieval").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const ragChunks = pgTable("rag_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => ragDocuments.id),
  chunkText: text("chunk_text").notNull(),
  createdAt: createdAt()
});

export const ragEmbeddings = pgTable("rag_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  chunkId: uuid("chunk_id").notNull().references(() => ragChunks.id),
  embedding: vector1536("embedding").notNull(),
  model: text("model").notNull(),
  createdAt: createdAt()
});
