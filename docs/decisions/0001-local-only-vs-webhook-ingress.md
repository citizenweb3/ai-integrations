# 0001 — Local-only invariant vs. webhook ingress

| Field | Value |
|---|---|
| **Date opened** | 2026-05-24 |
| **Status** | Open — pending operator decision |
| **Affected phases** | Phase 2 (Inbound/Outbound Email), Phase 5 (Notifications and Guardrails) |
| **Affected decisions** | #5, #286, #296 (local-only); #16, #23, #36, #41, #90 (inbound/Telegram) |
| **Blocks** | Live end-to-end smoke (Tier 1 inbound, Tier 2 Telegram inbound) |

---

## TL;DR

The canonical design declares the MVP as **local-only, single-operator**. The implemented Phase 2 + Phase 5 surface includes **inbound webhook receivers** (Resend delivery, Resend inbound, Telegram bot) that fundamentally require a **publicly reachable HTTP endpoint** to function. These two requirements cannot coexist without an explicit operational deviation. The contradiction was not surfaced in the original decision log and is not addressed in `docs/runtime-and-ops.md`.

Until a deviation is chosen and documented, the system **cannot complete an end-to-end real-traffic loop**, even though every code path is implemented, tested at the DB level, and verified locally.

---

## Context

### What the canonical design declares

| Source | Decision / passage |
|---|---|
| `bizdev-outreach-mvp-decision-log.md:11` | Decision #5: «Dashboard is local-only in MVP and assumes a single operator.» |
| `bizdev-outreach-mvp-decision-log.md:292` | Decision #286: «MVP runtime is local-first Docker Compose with `dashboard`, `worker`, and `postgres` services.» |
| `bizdev-outreach-mvp-decision-log.md:302` | Decision #296: «MVP security model is local-only and single-operator; future multi-user auth requires separate design.» |
| `bizdev-outreach-mvp-canonical-design.md:9` | «Build a local-first, operator-controlled outreach system for Citizen Web3 and ValidatorInfo…» |
| `bizdev-outreach-mvp-canonical-design.md:739` | «Because the dashboard is local-only in MVP, Telegram deep links are only considered actionable in the desktop/local workflow.» |
| `bizdev-outreach-mvp-canonical-design.md:6057` | «MVP is local-first and Dockerized.» |
| `bizdev-outreach-mvp-canonical-design.md:6250` | «MVP is local-only and single-operator, but it still handles sensitive outreach data.» |

### What Phase 2 + Phase 5 require

| Source | Functional requirement |
|---|---|
| Decision #50 | «Inbound webhook/event processing is idempotent.» (implies inbound webhook **is** a code path.) |
| Decision #16 | «Warm replies remain in MVP.» (requires inbound delivery.) |
| Decision #36 | «Inbound intent classification is part of MVP.» (requires inbound delivery.) |
| Decision #41 / #90 | «Telegram only carries urgent/high-value notifications and summary links.» «Telegram may become a secondary command surface…» (requires Telegram inbound webhook OR polling.) |
| Phase 2 plan deliverable | «Resend inbound webhook ingestion» |
| Phase 5 plan deliverable | «Telegram-to-command integration boundary» |

### What is implemented

| Path | File | Behaviour |
|---|---|---|
| Resend delivery webhook | `apps/dashboard/app/webhooks/resend/events/route.ts` | `POST` receiver, svix-signed, expects external POST |
| Resend inbound webhook | `apps/dashboard/app/webhooks/resend/inbound/route.ts` | `POST` receiver, svix-signed, expects external POST |
| Telegram bot inbound | `apps/dashboard/app/webhooks/telegram/[secret]/route.ts` | `POST` receiver, secret-in-URL-path + optional `X-Telegram-Bot-Api-Secret-Token` header, expects external POST |

All three handlers are thin: they verify the signature, persist the raw event, and return 200 within Telegram/Resend retry tolerances. The heavy work is enqueued onto `jobs` and runs in the worker.

---

## The contradiction

| Property | Local-only invariant | Webhook ingress surface |
|---|---|---|
| Network reachability | Operator's machine bound to `localhost:3000`. No service in the public internet should reach it. | Resend / Telegram servers must POST to a public HTTPS URL. `localhost` is not reachable from their infrastructure. |
| Single-operator security model | UI bound to the operator's machine; no remote login surface. | Webhook URL is bearer-secret authenticated (svix HMAC for Resend, path-secret + optional header for Telegram); access control is per-secret, not per-machine. |
| Operational footprint | One laptop. Power off ⇒ system off. | Webhook delivery is push-only. If the endpoint is unreachable at the moment the provider POSTs, the message is queued by the provider (Resend retains 7d, Telegram retries with exponential backoff) but never arrives synchronously while the laptop is offline. |
| Decision-log scope | Decisions #5/#286/#296 frame the **dashboard**, **runtime topology**, and **security model**. | Decisions about **webhook delivery topology** were never written. The contradiction is **not** addressed in the decision log. |

The contradiction is structural: there is no setting of local-only's parameters that allows an externally-served webhook endpoint to reach a machine that is not externally addressable.

---

## What does not work without a resolution

Concrete examples — every one of these is a real product capability that is implemented but inert:

1. **Reply detection.** Operator sends a cold email; recipient replies. Without inbound webhook delivery, the reply never enters `inbound_messages`. Warm reply, classification, `attach_inbound_to_thread`, suppression on `unsubscribe` reply class — none fire.
2. **Suppression on provider events.** A `complaint` / `hard_bounce` / `unsubscribe` from Resend never reaches `processProviderWebhookEvent`. Subsequent sends to that recipient are not blocked by `active_suppression_hard` (only by manual operator entry in `/policies`).
3. **Send delivery status reconciliation.** `outbound_messages.status` stays `send_requested` indefinitely — no `sent` / `bounced` / `complained` transition arrives.
4. **Telegram operator commands.** `/queue`, `/approve`, `/confirm`, `/snooze`, `/dismiss`, `/resolve` from the operator's phone do not reach `processTelegramInboundUpdate`. Telegram outbound notifications (worker → bot → operator) still work because they are **outbound** HTTP from the worker.

What **does** continue to work in pure local-only:

- Outbound send (worker → Resend HTTPS, outbound traffic).
- Vertex Gemini agent calls (worker → Vertex HTTPS, outbound traffic).
- Telegram **notifications from** the worker (worker → Telegram Bot API, outbound traffic).
- All DB-level integration tests, fixture-driven webhook simulation tests, schema invariants, idempotency dedup, guardrail engine evaluation.

The asymmetry is exactly the inbound/outbound distinction: **outbound calls from local machines are fine; inbound calls to local machines are blocked by NAT and the absence of a public DNS/TLS endpoint.**

---

## Resolution options

Six paths considered. Pick exactly one — they are mutually exclusive operational stances.

### Option A — One-off tunnel only during smoke verification

Run `cloudflared tunnel` or `ngrok http 3000` for the duration of a smoke session. Configure Resend webhooks and Telegram `setWebhook` against the temporary URL. After smoke, close the tunnel and revert. The "production" mode of the system never serves webhooks.

- **Pro:** Zero code change. Smoke verification becomes physically possible. Local-only invariant preserved during normal operation.
- **Con:** Smoke does not match steady-state behaviour — steady-state is broken. The smoke proves the code, not the deployment. Real-world reply detection / suppression / Telegram operator commands never fire between smoke sessions.
- **Verdict:** Acceptable as a **temporary verification tool**, not as an operational model.

### Option B — Permanent persistent tunnel (operator's machine has stable externally-routable ingress)

Configure Cloudflare Tunnel (or equivalent) as a daemon on the operator's machine. The tunnel domain is registered in Resend / Telegram. As long as the machine is on, webhooks arrive. When the machine is off, providers queue (Resend ~7d, Telegram retries) and deliver on next online.

- **Pro:** Closest to the canonical "single laptop is the whole system" model while still functional. No VPS, no separate auth surface, no multi-machine deployment. Decisions #5/#286/#296 reformulate as «local compute and storage; externally-addressable webhook ingress.» Single-operator security preserved through webhook secrets.
- **Con:** Operator must keep the machine online to receive real-time replies. Reformulation of local-only invariant is non-trivial — it's a deliberate weakening of one property (network reachability) while preserving the others (compute locality, single-operator UI, no remote login).
- **Verdict:** Most honest path. Requires explicit new decision in the log (proposed text below).

### Option C — Telegram migrates to long polling; Resend stays webhook-only

Refactor Telegram bot inbound from `setWebhook` to `getUpdates` polling loop in the worker. Telegram inbound works in pure local-only (no public endpoint needed). Resend remains a problem — solve it separately via Option A, B, or D.

- **Pro:** Resolves half the contradiction (Telegram) without architectural deviation. Telegram bot becomes truly local-only-compatible.
- **Con:** ~150 LoC + new ticket. Does not solve Resend inbound. Polling has minor latency (~1s) vs. webhook (~50ms). Telegram API still requires outbound HTTPS, but that already works.
- **Verdict:** Worth doing **regardless** of the Resend choice — closes one of two legs cleanly. Open a follow-up ticket; not a blocker for the architectural decision on Resend.

### Option D — Replace Resend inbound webhook with IMAP/MX-based mailbox pull

Register MX records pointing to a mailbox the worker can pull via IMAP. The worker polls the mailbox, parses messages, writes to `inbound_messages` directly. Resend remains for outbound only.

- **Pro:** Resend inbound webhook ceases to be a dependency. Local-only fully preserved if the IMAP server is also local (Postfix/Dovecot in Docker Compose) or external but pull-only.
- **Con:** **Large scope** — re-implements Phase 2 inbound path. MX records require domain control. SPF/DKIM/DMARC alignment for the mailbox. Likely 1–2 weeks of focused work. Phase 2 acceptance test «receive one reply into the same system» needs to be re-validated against the new path. Decisions #1 (single Resend mailbox identity) and #2 (Resend for outbound and inbound in MVP) need to be partially revoked.
- **Verdict:** Architecturally clean but expensive. Out of MVP scope unless the local-only invariant is non-negotiable AND Resend inbound is non-negotiable AND Option B is rejected.

### Option E — Deploy dashboard + worker to a small VPS / Cloud Run

Move the dashboard and worker to a hosted environment. The endpoint is publicly reachable by design. Postgres can stay on-VPS or migrate to managed.

- **Pro:** Webhooks "just work". Operator accesses dashboard remotely. The contradiction dissolves because local-only is dropped.
- **Con:** Decision #5/#286/#296 are revoked, not adapted. Decision #296 (single-operator security model) needs new design — remote access needs auth. This is **post-MVP scope**, not a config flip. Loses the local-first property entirely, which was a core design tenet.
- **Verdict:** Valid for post-MVP. Not appropriate for current MVP phase.

### Option F — Forever fixture-driven inbound; live webhook ingress is out of MVP

Accept that the MVP never receives real inbound webhooks. All inbound verification is via fixture-driven curl scripts that POST locally with valid svix signatures. Phase 2 acceptance test «receive one reply into the same system» is interpreted as «process a reply payload through the same system» rather than «accept a reply over the wire from Resend.»

- **Pro:** Local-only invariant fully preserved with zero deviation. Zero code change. Smoke is fully achievable.
- **Con:** **No live loop is ever proven.** Subtle integration bugs (Resend payload format drift, svix signature format change, header capitalization, retry semantics) are never caught. Phase 2 / Phase 5 acceptance tests get re-interpreted, not honoured. The product, as delivered, cannot do its job — operators receive replies in their own inbox and must manually re-route them.
- **Verdict:** Acceptable if and only if the system is being delivered as a draft-generation tool, not a closed-loop outreach platform. Re-frames the MVP scope downward.

---

## Trade-offs at a glance

| Option | Local-only preserved | Live loop works | Code change | New decision required |
|---|---|---|---|---|
| **A** Smoke-only tunnel | Yes (between smokes) | No (only during smoke) | None | Document smoke procedure |
| **B** Permanent tunnel | Adapted | Yes | None | Yes — reformulate #5/#286/#296 |
| **C** Telegram polling | Yes (Telegram leg) | Telegram yes; Resend still blocked | ~150 LoC | Combine with A/B/D for Resend |
| **D** IMAP/MX | Yes | Yes (via IMAP) | Large (re-do Phase 2 inbound) | Yes — partial revoke of #1/#2 |
| **E** VPS deploy | No | Yes | Medium (deploy + auth) | Yes — full revoke of #5/#296 |
| **F** Fixture-only forever | Yes | No (never) | None | Yes — re-frame Phase 2 acceptance |

---

## Recommendation

**Option B + Option C in combination.**

Rationale:

1. **Option C is cheap and uncontroversial.** Telegram polling is a small refactor that closes one leg of the contradiction without touching any architectural decision. Do it regardless.
2. **Option B is the most honest framing of the original intent.** The decision log's local-only invariant was written about the **operator's interaction surface** (where the dashboard lives, where data is stored, who has access). It was not written about the **provider's webhook delivery topology**, because at the time of writing this distinction was not yet a forced choice. Adopting Option B formally separates these two concerns: local compute and storage; externally-addressable webhook ingress with secret-based auth.
3. **Option A is a smoke tool, not a model.** Useful, but not a permanent answer.
4. **Options D / E / F all force MVP scope changes.** D doubles Phase 2 work. E revokes decisions wholesale. F downgrades the deliverable. None of these are appropriate at this phase.

### Proposed new decision text

To be added to `bizdev-outreach-mvp-decision-log.md` as `#297` and `#298`:

> **#297. Webhook ingress topology.** Resend delivery, Resend inbound, and (until #298 lands) Telegram bot inbound require an externally-addressable HTTPS endpoint terminating on the operator's local machine. The operator deploys a persistent egress tunnel (Cloudflare Tunnel preferred; ngrok / equivalent acceptable) that publishes `https://<operator-domain>/webhooks/...` to the providers and routes traffic to `localhost:3000`. The tunnel daemon runs alongside the Docker Compose stack on the operator's machine. Local-only as declared in #5/#286/#296 continues to apply to operator UI access, compute, storage, and the security model; webhook ingress is a deliberate, secret-authenticated exception scoped to provider POSTs.

> **#298. Telegram inbound transport.** The Telegram bot inbound path migrates from `setWebhook` to `getUpdates` long polling, executed inside the worker process. This removes Telegram's dependency on a public endpoint and reduces #297's surface to Resend only. The polling loop runs in the `telegram` worker pool to preserve the isolation introduced by T-017. Existing `processTelegramInboundUpdate` logic is reused unchanged; only the transport layer is replaced.

---

## Implications for verification

Once a resolution is in place:

| Smoke tier | Status under proposed resolution (B + C) |
|---|---|
| Tier 1 — Resend outbound | Works today (outbound HTTP). |
| Tier 1 — Resend delivery webhook | Works under #297 tunnel. |
| Tier 1 — Resend inbound webhook | Works under #297 tunnel. |
| Tier 1 — Suppression auto-routing | Works under #297 tunnel (depends on delivery webhook). |
| Tier 1 — Send ambiguous reconcile | Works (outbound + delivery webhook combined). |
| Tier 2 — Telegram bot commands | Works under #298 polling (no tunnel needed). |
| Tier 2 — Worker-down / queue-depth alerts | Works today (outbound to Telegram Bot API). |
| Tier 3 — Vertex agent pipeline | Works today (outbound to Vertex). |
| Tier 4 — Recovery, health, nightly | Works today (all local). |

---

## Implications for documentation

If Option B + C is adopted, update:

| File | Change |
|---|---|
| `bizdev-outreach-mvp-decision-log.md` | Append #297 and #298. |
| `bizdev-outreach-mvp-canonical-design.md` § 739 | Update Telegram deep-link note to reflect polling transport. |
| `docs/runtime-and-ops.md` | Add «Webhook ingress» section documenting the tunnel setup, secret rotation, monitoring. |
| `docs/handoff/CHECKPOINTS.md` | Add follow-up ticket for the polling refactor (Option C). |
| `apps/dashboard/app/webhooks/telegram/[secret]/route.ts` | After polling ships, this file is removed (or kept as compatibility shim with a deprecation note). |

---

## Open questions

1. **Tunnel provider choice.** Cloudflare Tunnel (free, requires Cloudflare-hosted domain), ngrok (free tier rotates URLs, paid for stable), tailscale funnel (TS-hosted domain), self-hosted (frp / WireGuard + nginx). Each has different trust model and rotation behaviour.
2. **Tunnel secret rotation.** When the operator rotates the tunnel URL or secret, both Resend webhook config and (if Option C is not yet shipped) Telegram `setWebhook` must be re-issued. Document the runbook.
3. **Polling cadence for #298.** Telegram `getUpdates` long-poll timeout is typically 30s. Confirm worker pool sizing absorbs the long-lived connection without starving other `telegram`-pool jobs.
4. **Behaviour during operator-machine offline.** Resend retains 7d, Telegram retries with backoff. Document max-acceptable downtime and the recovery flow (event-log will be sparse during the offline window).
5. **Tunnel as a single point of trust.** Anyone holding the tunnel URL + svix secret can POST forged webhooks. Confirm svix signature verification covers this (it does — that is precisely svix's purpose). Document the secret-rotation runbook.

---

## Decision pending

Selection of Option A / B / C / D / E / F (or a combination) is left to the operator. Until selected, the contradiction remains open and live-traffic verification is blocked.
