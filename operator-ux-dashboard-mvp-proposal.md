# Operator UX / Dashboard Flows MVP

## Goal

Define an operator-facing MVP for the outreach pipeline where:
- Telegram is the primary action surface for approvals and urgent replies.
- Next.js dashboard is the primary visibility, triage, and policy surface.
- One operator (Ivan) can monitor queue health, inspect threads, and intervene without turning the product into a full CRM.

## UX Principles

- Telegram-first for high-urgency actions: approve draft, skip, redo, send generic, approve reply.
- Dashboard-first for context-heavy work: inspect inbox, read full thread, review sources, understand why something is blocked.
- Single-thread truth: every outbound/inbound message is visible in one thread timeline tied to prospect + contact.
- Policy-driven, not workflow-builder-driven: MVP exposes a small set of editable rules, not arbitrary automation design.
- Manual override always available: operator can hold, skip, or take over a thread at any point.

## IA: Next Dashboard

### 1. `/dashboard`
Primary operator home.

Sections:
- Today summary: sent, opened, replied, skipped, generic sent.
- Action queues:
  - Drafts awaiting approval
  - Low-confidence prospects
  - Inbox threads needing reply
  - Manual-hold threads
- Batch health:
  - current batch window
  - next scheduled run
  - last successful cron run
  - webhook health
- Hot leads:
  - replied today
  - opened multiple times
- Recent issues:
  - send failed
  - inbound parse failed
  - tracking stale

Primary actions:
- Open filtered inbox
- Open low-confidence queue
- Open thread detail
- Open policies

Notes:
- No full draft editing UI in dashboard MVP.
- Draft approval remains in Telegram; dashboard only shows queue visibility and detail links.

### 2. `/inbox`
Unified operator queue for all active conversations and blocked items.

Default tabs:
- `Needs reply`
- `Awaiting approval`
- `Low confidence`
- `Manual hold`
- `All active`

List columns:
- Company
- Contact
- Pillar
- Last message / last event
- Thread status
- Last activity timestamp
- Owner mode: `agent`, `awaiting_ivan`, `manual`

Filters:
- Pillar
- Status
- Date range
- Has reply
- Opened multiple times
- Low-confidence only

Bulk actions:
- Only non-destructive in MVP: mark read, move to manual hold, clear notification state.

### 3. `/threads/[threadId]`
Single thread view for outbound + inbound history.

Layout:
- Header:
  - company, contact, pillar, current thread status
  - last outbound subject
  - last activity
- Main timeline:
  - outbound emails
  - inbound replies
  - operator actions
  - agent events
- Right context rail:
  - prospect summary
  - contact data
  - research sources used
  - confidence notes
  - related sent emails / similar-email references
  - current policy decisions applied

Primary actions:
- `Draft reply`
- `Approve reply and send`
- `Handle manually`
- `Return to agent`
- `Skip / close`
- `Open raw email`

Notes:
- Reply drafting may be triggered from dashboard, but final approve/send stays aligned with Telegram flow in MVP.
- Timeline must clearly separate message events from system events.

### 4. `/policies`
Simple admin page for guardrails and operator preferences.

Policy groups:
- Outreach policy:
  - work window
  - batch size
  - daily send cap
  - confidence threshold
- Draft policy:
  - allow generic send on low confidence
  - require approval for every draft
- Reply policy:
  - always require operator approval before send
  - keywords that force manual hold
  - default reply model
- Notification policy:
  - Telegram event toggles
  - digest schedule
  - urgent alert thresholds

Constraints:
- No versioned policy engine in MVP.
- No per-pillar branching logic beyond simple field-level settings.

## Inbox / Thread UX Model

### Inbox Intent
Inbox is not a mailbox clone. It is an operator triage queue over outreach threads.

Each row represents one active thread state, not every raw email event.

### Thread Intent
Thread view answers four operator questions fast:
1. What happened?
2. Why did the agent do it?
3. What should happen next?
4. Do I trust the suggested next action?

### Required Context in Thread View

- Full message history in order
- Current thread status
- Drafted next reply, if present
- Research evidence used for initial outreach
- Confidence and low-confidence reasons
- Tracking summary: sent/opened/replied

## Key States

### Prospect / Draft States

- `new`
- `researching`
- `researched`
- `drafting`
- `draft_ready`
- `low_confidence`
- `approved`
- `edited`
- `redone`
- `skipped`
- `generic_sent`
- `sent`
- `opened`
- `replied`
- `closed`

### Thread States

- `awaiting_first_send`
- `awaiting_operator_approval`
- `sent_no_reply`
- `reply_received`
- `reply_draft_ready`
- `manual_hold`
- `reply_sent`
- `resolved`

### System Flags

- `send_failed`
- `inbound_parse_failed`
- `tracking_stale`
- `webhook_unhealthy`

System flags should not replace business status; they should appear as secondary badges and dashboard alerts.

## Key Actions

### Operator Actions

- Approve draft
- Approve all in batch
- Edit via Telegram instruction
- Redo with stronger model
- Send generic
- Skip
- Draft reply
- Approve reply and send
- Put thread on manual hold
- Return thread to agent
- Close thread

### Agent/System Actions

- Create draft
- Re-draft after edit
- Re-draft with Opus
- Send via Resend
- Poll open/click status
- Capture inbound reply
- Generate reply draft
- Trigger Telegram notification

## Telegram Notification Model

Telegram remains the high-priority action bus. Dashboard is the system of record.

### Notification Types

1. Batch approval
- Trigger: `draft_ready` batch assembled
- Content: batch id, count, short list of companies, pillars, subjects
- Actions: `Approve All`, `Review in Telegram`, `Open Dashboard`

2. Single draft review
- Trigger: operator chooses one-by-one review
- Content: full draft, sources, confidence summary, similar-email note
- Actions: `Send`, `Edit`, `Redo`, `Skip`, `Open Dashboard`

3. Low confidence
- Trigger: confidence below threshold after research
- Content: company, missing fields, reason
- Actions: `Send Generic`, `Skip`, `Open Dashboard`

4. Reply received
- Trigger: inbound email captured
- Content: company, sender, short preview, urgency markers
- Actions: `Draft Reply`, `Read Full`, `Handle Manually`, `Open Thread`

5. Reply draft ready
- Trigger: agent prepared reply draft
- Content: reply summary + rationale
- Actions: `Approve & Send`, `Redo`, `Handle Manually`, `Open Thread`

6. Daily digest
- Trigger: fixed schedule
- Content: sent, opened, replied, hot leads, blocked items
- Actions: `Open Dashboard`

7. Operational alert
- Trigger: webhook/send/tracking failure
- Content: failure type, affected item count
- Actions: `Open Dashboard`

### Telegram Rules

- Telegram must carry enough context for yes/no decisions.
- Telegram should not be the only place where state exists.
- Every Telegram action must deep-link to the corresponding dashboard thread or filtered queue.
- Dashboard actions may trigger Telegram confirmations, but must not create a second parallel approval model.

## MVP Flow Summary

### Flow 1: Draft approval
- Agent produces draft
- Telegram sends batch notification
- Operator approves in Telegram
- Dashboard updates counters and queue state

### Flow 2: Low confidence
- Agent cannot reach confidence threshold
- Telegram asks: generic or skip
- Dashboard shows why item is blocked

### Flow 3: Reply handling
- Inbound reply enters webhook
- Thread appears in `Needs reply`
- Telegram alerts operator
- Agent drafts reply
- Operator approves reply in Telegram
- Thread returns to `sent_no_reply` or `resolved`

### Flow 4: Manual takeover
- Operator marks thread `manual_hold`
- Agent stops outbound/reply actions for this thread
- Dashboard remains the tracking surface

## Not In MVP

- Full web-based draft composer
- Rich CRM features: notes, tasks, pipeline customization, ownership routing
- Multi-user roles and permissions
- Auto-follow-up sequences
- Warm reply automation without approval
- Omnichannel inbox for Telegram/Discord/LinkedIn/X
- A/B testing and experiment dashboard
- Complex analytics beyond daily counters, hot leads, and queue health
- Policy versioning, simulations, or workflow builder
- Mobile-first dashboard optimization beyond basic responsive support

## Implementation Notes

- Dashboard should be optimized around thread and queue views, not prospect CRUD.
- Telegram and dashboard must share the same canonical status model.
- If time is tight, implement in this order:
  1. `/dashboard`
  2. `/inbox`
  3. `/threads/[threadId]`
  4. `/policies`

