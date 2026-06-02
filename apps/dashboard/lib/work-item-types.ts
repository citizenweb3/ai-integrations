// T-026BL — presentation registry for inbox work-item types.
//
// Each live work-item type (created via createWorkItem in @bizdev/db) gets a
// human label, a glyph, and a semantic tone so the inbox can render a type-aware
// card instead of dumping the raw snake_case `type · reasonCode`. Tones map to
// the same palette language used by the Badge primitive.
//
// Keep this in sync with `inboxTabTypeFilters` in packages/db/src/repositories.ts
// — if a new type is routed there, add it here too (unknown types fall back to a
// neutral chip so nothing ever renders blank).

export type WorkItemTone = "accent" | "primary" | "warning" | "danger" | "neutral";

export type WorkItemMeta = {
  label: string;
  glyph: string;
  tone: WorkItemTone;
  // True when the item generally carries an inbound message worth previewing
  // (reply / unmatched buckets). Used to decide whether to render the preview
  // block even before checking the row's inbound fields.
  inboundDriven?: boolean;
};

const REGISTRY: Record<string, WorkItemMeta> = {
  // — replies —
  warm_reply_review_needed: { label: "Warm reply", glyph: "🔥", tone: "accent", inboundDriven: true },
  wrong_person_reassignment: { label: "Wrong person", glyph: "↪", tone: "warning", inboundDriven: true },
  not_now_resurface: { label: "Deferred", glyph: "⏳", tone: "neutral", inboundDriven: true },
  reply_unsubscribe_recorded: { label: "Unsubscribe", glyph: "🚫", tone: "danger", inboundDriven: true },
  reply_complaint_received: { label: "Complaint", glyph: "🚨", tone: "danger", inboundDriven: true },

  // — unmatched —
  unmatched_inbound_message: { label: "Unmatched inbound", glyph: "✉", tone: "neutral", inboundDriven: true },
  thread_match_ambiguous: { label: "Ambiguous match", glyph: "❓", tone: "warning", inboundDriven: true },
  unmatched_inbound_summary: { label: "Unmatched summary", glyph: "✉", tone: "neutral", inboundDriven: true },
  inbound_parse_failed: { label: "Parse failed", glyph: "⚠", tone: "danger", inboundDriven: true },
  send_ambiguity_review: { label: "Send ambiguity", glyph: "⚠", tone: "warning" },

  // — approvals —
  draft_review_pending: { label: "Draft review", glyph: "✍", tone: "primary" },

  // — attention —
  policy_blocker: { label: "Policy block", glyph: "🛡", tone: "danger" },
  campaign_scope_incomplete: { label: "Scope incomplete", glyph: "◷", tone: "warning" },
  cooldown_expired: { label: "Cooldown expired", glyph: "♻", tone: "accent" },
  followup_eligible: { label: "Follow-up due", glyph: "♻", tone: "accent" },
  suppression_event_review: { label: "Suppression review", glyph: "🚫", tone: "warning" },
  provider_event_reconciliation: { label: "Provider event", glyph: "⚙", tone: "neutral" },
};

function humanizeType(type: string): string {
  return type
    .split("_")
    .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export function workItemMeta(type: string): WorkItemMeta {
  return REGISTRY[type] ?? { label: humanizeType(type), glyph: "•", tone: "neutral" };
}

// Tailwind class fragments per tone. `chip` styles the type pill; `bar` is the
// 2px left accent the card uses to carry the tone at a glance.
export const TONE_CLASSES: Record<WorkItemTone, { chip: string; bar: string; text: string }> = {
  accent: {
    chip: "border-[var(--accent)]/40 text-[var(--accent)] bg-[var(--accent)]/[0.06]",
    bar: "bg-[var(--accent)]",
    text: "text-[var(--accent)]",
  },
  primary: {
    chip: "border-[hsl(var(--primary))]/40 text-[hsl(var(--primary))] bg-[hsl(var(--primary))]/[0.08]",
    bar: "bg-[hsl(var(--primary))]",
    text: "text-[hsl(var(--primary))]",
  },
  warning: {
    chip: "border-yellow-500/40 text-yellow-300 bg-yellow-500/[0.06]",
    bar: "bg-yellow-400",
    text: "text-yellow-300",
  },
  danger: {
    chip: "border-red-500/40 text-red-300 bg-red-500/[0.08]",
    bar: "bg-red-400",
    text: "text-red-300",
  },
  neutral: {
    chip: "border-white/20 text-white/70 bg-white/[0.04]",
    bar: "bg-white/25",
    text: "text-white/70",
  },
};
