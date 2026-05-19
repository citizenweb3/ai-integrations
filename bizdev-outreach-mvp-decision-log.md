# BizDev Outreach MVP Decision Log

**Status**: Accepted decisions consolidated from review and brainstorming

## Accepted Decisions

1. Use one mailbox identity for the whole lifecycle: `partner@citizenweb3.com`.
2. Use `Resend` for outbound and inbound in MVP.
3. Do not use parallel inbound ownership on the same address.
4. Review happens in `Next dashboard`; Telegram is for notifications.
5. Dashboard is local-only in MVP and assumes a single operator.
6. Telegram deep links are only actionable in the desktop/local workflow; mobile notifications may be informational-only.
7. Cold outreach starts with one primary contact per company.
8. Parallel cold emails to multiple contacts in the same company are not allowed.
9. `Send Generic` is removed from MVP.
10. `Approve All` is removed from MVP.
11. `Outreach` remains a first-class business aggregate separate from draft/message/thread transport records.
12. Drafts, outbound messages, inbound messages, and threads are separate concepts.
13. Inbox is backed by explicit or strictly derived work-item semantics, not ad hoc table joins.
14. Status is split across explicit axes, not one overloaded field.
15. `opens` are weak secondary signals, not core optimization targets.
16. Warm replies remain in MVP.
17. RAG remains in MVP as semantic memory, not as workflow truth.
18. Quality scoring is rule-based and explainable.
19. All draft versions are stored.
20. Free-text feedback and reason tags are both stored.
21. Separate suppression/do-not-contact layer is mandatory.
22. Separate policy-state persistence exists for cooldowns, retry-after, manual holds, overrides, and compliance flags.
23. One active thread per company at a time.
24. A thread may include multiple participants from the same company.
25. Thread matching is headers-first with heuristic fallback.
26. Ambiguous replies always require manual triage.
27. Dashboard pages for MVP are `Inbox`, `Thread View`, `Organization Detail`, and `Policies`.
28. Inbox is a priority work queue, not a mailbox clone.
29. Thread View is the main operator surface.
30. Policies is an operational page, not a full settings product.
31. Draft review lives inside Thread View.
32. Both `Manual Edit` and `AI Revise` exist in MVP.
33. `Research More` is separate from `AI Revise`.
34. Confidence is decomposed into fact confidence, contact fit, and draft readiness.
35. Warm drafts are generated automatically only for safe inbound classes.
36. Inbound intent classification is part of MVP.
37. `wrong_person` is a reassignment flow, not a hard close.
38. `not_now` is a deferred state with cooldown/retry date.
39. Automatic follow-up sequences are out of MVP.
40. `Follow-up eligible` exists as a manual work item.
41. Telegram only carries urgent/high-value notifications and summary links.
42. Dashboard uses SSR-first pages.
43. No `Server Actions` by default; use explicit mutation handlers and shared services.
44. `Postgres + Drizzle` is the MVP persistence stack.
45. Operator actions and system events are logged from day one.
46. Timeline is derived from messages plus event log.
47. Inbound messages are stored in parsed + raw form.
48. Outbound messages are stored in layered content/provider/header form.
49. Outbound sends are idempotent.
50. Inbound webhook/event processing is idempotent.
51. Operator commands are also idempotent where repeat clicks/retries could create side effects.
52. Safe retries exist for transient send failures only.
53. Outbound attachments are out of MVP; inbound attachments are minimally supported.
54. No separate analytics page in MVP.
55. No separate prospect management page in MVP.
56. Background processing is continuous.
57. Operator review is session-based.
58. Sending is operator-controlled: every outbound send requires explicit operator approval, while the worker performs the provider side effect after approval and guardrails.
59. MVP is zero-autosend.
60. Pre-send guardrails remain mandatory even with manual send.
61. Timing is advisory and should prefer recipient-local time.
62. Cold and warm outbound use different policy rules.
63. MVP must collect training-ready data for future autosend.
64. `autosend_readiness_label` exists in MVP as a draft-level annotation.
65. The readiness label is rule-based by default with optional operator override.
66. RAG storage lives in `Postgres` via `pgvector`.
67. Vector retrieval is planned with `HNSW` indexing.
68. Retrieval always uses structured narrowing before vector search.
69. Approved/final artifacts form the positive retrieval corpus.
70. Rejected and strongly corrected drafts are preserved as a negative corpus for anti-pattern memory.
71. Worker orchestration is event-driven and asynchronous, not a single linear blocking pipeline.
72. Stage handlers have explicit contracts and bounded side effects.
73. MVP does not use a free-form autonomous multi-agent mesh inside the worker.
74. `Campaign` is a first-class entity that captures top-level operator intent.
75. Operator commands are campaign-oriented and high-level; low-level orchestration commands are internal to the worker.
76. The dashboard must support company-level detail/history/results per organization.
77. MVP still does not require a full CRM list page, but it does require an organization detail surface.
78. Campaign lifecycle is `drafting_scope -> active -> paused -> closed`.
79. `pause` blocks new cold campaign expansion but does not block inbound/reply/compliance processing.
80. `start_campaign` is a seed action that creates initial internal orchestration work; it is not a giant synchronous flow.
81. Campaign expansion proceeds asynchronously through discovery, enrichment, contact selection, and drafting.
82. The system uses a small explicit orchestration vocabulary split into commands, jobs, and events.
83. Operator commands are distinct from internal system commands.
84. Jobs are retryable executable worker tasks and remain distinct from business-intent commands.
85. Events are append-only past-tense facts and remain distinct from both commands and jobs.
86. Command handlers are thin synchronous boundaries that may perform lightweight validation, idempotency, and small immediate state transitions.
87. Heavy work, external side effects, retries, and orchestration fan-out belong to worker jobs, not command handlers.
88. Campaign lifecycle, approval, save/skip, and policy/manual-hold decisions are immediate-transition commands.
89. Research, generation, memory indexing, and recompute flows are enqueue-only commands; webhook ingress persists `webhook_events` and enqueues `job.process_webhook_event` directly.
90. Telegram may become a secondary command surface, but dashboard remains the primary control surface in MVP.
91. Telegram-originated actions must map into the same persisted command system as dashboard actions.
92. Free-form natural-language command creation from Telegram is deferred; bounded structured bot commands come first.
93. Operator, internal system, and Telegram-originated intents live in one shared durable `commands` table; webhook provider facts live in `webhook_events`.
94. The `commands` table is distinguished by `source` (`operator`, `system`, `telegram`) and supports shared lifecycle, idempotency, and causality tracing.
95. Only meaningful orchestration intents become persisted commands; micro-steps inside job execution do not.
96. The system uses a separate durable `jobs` table distinct from commands and events.
97. Worker execution is lease-based with retries, backoff, and Postgres polling.
98. Jobs support `concurrency_key` to prevent conflicting mutations on the same campaign, organization, or thread.
99. Exhausted and failed jobs must remain visible as operational state, not just worker logs.
100. The system uses a separate `job_runs` table to record execution-attempt history per job.
101. `job_runs` captures technical execution telemetry and keeps low-level retry noise out of the business-readable event log.
102. `event_log` contains domain/system facts, not low-level worker execution noise.
103. Transient attempt failures remain in `job_runs`; only meaningful workflow/product failures belong in `event_log`.
104. `event_log` must include causality, lineage, actor, and correlation fields sufficient for timeline, debugging, and learning.
105. `event_log` is append-only history, not a full state snapshot store.
106. MVP uses one explicit `correlation_id` and does not split tracing into separate `trace_id` and `span_id`.
107. A new `correlation_id` is created only at the root of a new logical workflow chain.
108. Downstream commands, jobs, events, and retries inherit the same `correlation_id`; new operator actions create new correlation roots even on the same entity.
109. MVP does not use a separate outbox table; external side effects use the durable `jobs` table as the practical outbox mechanism.
110. Domain state changes and external-side-effect job creation must happen in one transaction.
111. External side effects must execute only from worker jobs, never directly from command handlers.
112. Job types are explicitly classified by external-risk level: outward communication, external compute/provider, and internal compute/state.
113. `job.send_email` is the strictest external side-effect job in the system.
114. Retry policy is defined by job class with per-job-type overrides, not by one global retry rule.
115. Ambiguous external communication outcomes are reconciled manually/systemically, not blindly retried.
116. Jobs may carry one primary `concurrency_key` to serialize conflicting mutations by campaign, organization, thread, or outreach.
117. `concurrency_key` complements database constraints and does not replace them.
118. MVP uses one worker runtime with multiple logical worker pools, not one flat runner and not many separate worker services.
119. Jobs carry an explicit `worker_pool` to protect urgent operator-facing flows from starvation.
120. MVP uses exactly three worker pools: `urgent`, `drafting`, and `background`.
121. Pool choice depends on workflow context, not only on low-level API type.
122. MVP does not use LangChain, ADK, LangGraph, or Vertex Agent Builder as the top-level system orchestration backbone.
123. The earlier `ADK` vs `LangGraph` deferral is superseded; ADK is selected for worker-agent stage services.
124. LangGraph or plain typed services remain fallback options only if ADK proves unsuitable during implementation, and only inside bounded stage services.
125. MVP explicitly separates agentic stage services from deterministic infrastructure and policy stages.
126. Prospect discovery, research, classification, and draft generation are agentic; ingress, indexing, state transitions, and policy enforcement stay deterministic.
127. ADK is selected as the stage-level agent orchestration framework for worker-agent workflows.
128. The top-level system orchestrator is already fixed as the custom Postgres-backed worker orchestration.
129. Stage-level agent orchestration is no longer open; it uses ADK.
130. The project now adopts `ADK` as the preferred framework for worker-agent workflows inside stage services.
131. `ADK` does not replace the top-level Postgres-backed system orchestrator.
132. Worker-agent execution should use Python ADK unless implementation constraints force a different ADK runtime.
133. Vertex AI Agent Engine is out of MVP; MVP model calls use direct Gemini/model API access through ADK model configuration.
134. ADK MCP support may be used for tools; A2A is deferred until agents cross service/team/organization boundaries.
135. ADK stage design uses `SequentialAgent`, `ParallelAgent`, `LoopAgent`, and `LlmAgent` explicitly per stage.
136. `LoopAgent` is allowed only for bounded validation/rewrite loops with strict iteration limits.
137. Inbound processing, memory indexing, policy, idempotency, and send guardrails remain outside ADK.
138. Agentic stage execution is persisted in framework-neutral `agent_runs`, `agent_run_events`, and `agent_run_artifacts` tables.
139. `runtime = adk` identifies the current implementation without baking ADK into table names.
140. Agent output is treated as a proposal; deterministic domain services apply validated output to domain tables.
141. ADK agents receive only typed allowlisted tools with narrow contracts.
142. ADK agents do not receive direct domain-write or send-email tools in MVP.
143. Meaningful ADK tool outputs are stored as `agent_run_artifacts`.
144. ADK toolsets are explicitly allowlisted per stage.
145. Web search is allowed only in discovery and organization research stages by default.
146. ADK draft/classification stages may return `needs_research`, but may not expand research autonomously.
147. ADK provides tool orchestration, but source-specific access such as Twitter/X or Reddit is implemented through custom typed tools or MCP tools.
148. General public web search can use Gemini Google Search grounding / ADK Google Search tooling where available.
149. External source tools require auth, rate limits, timeouts, response caps, source attribution, artifact persistence, and stage allowlists.
150. ADK model selection is deterministic through `ModelPolicyResolver`; agents do not choose their own models.
151. Gemini is the default model family for ADK-backed worker-agent stages.
152. Model/provider fallback is explicit, stage-configured, and used only for provider/runtime availability failures.
153. Stages reference model policy profiles, and concrete model names are resolved from config/env.
154. Every agent run persists both the model profile and resolved model policy values.
155. Prompt templates, output schemas, validation rules, model policies, and retrieval policies are versioned.
156. Agent runs store prompt/schema/rule/retrieval references and checksums sufficient to explain generated output.
157. Prompt/schema/rule/retrieval registries live in repo/config for MVP; Postgres stores per-run resolved refs and artifacts.
158. DB-backed prompt/schema/rule registry is deferred until prompt operations become a real product workflow.
159. Campaign-derived ADK stages receive a materialized `campaign_context` containing objective, offer, CTA, targeting, guidance, forbidden claims, and policy profile.
160. Prompt templates do not read from the database; domain services assemble materialized context before prompt rendering.
161. Forbidden claims are both prompt guidance and validation constraints.
162. Campaign context conditions RAG retrieval filters.
163. Default RAG usage is deterministic pre-retrieval before ADK prompt assembly.
164. Runtime ADK RAG tool calls are allowed only in bounded discovery/research cases.
165. Positive and negative RAG corpora remain labeled separately and are not mixed as equal examples.
166. Web/source-capable ADK runs require explicit source budgets and hard stop behavior.
167. Search and fetch are separate tools; source tool calls are persisted as artifacts.
168. Research source outputs carry source quality tags that feed fact confidence.
169. ADK research output produces `proposed_facts`; deterministic validators promote them to verified/low-confidence/conflicting/rejected/needs-review facts.
170. Evidence refs are mandatory for facts, and final `safe_for_copy` is deterministic rather than raw agent judgment.
171. Research uses first-class tables for snapshots, facts, evidence, fact-evidence links, and contact candidates.
172. Research snapshots are versioned, and drafts reference the research snapshot and facts used during generation.
173. Draft generation output must include `used_fact_refs`, `unsupported_claims`, and `soft_claims`.
174. Company-specific claims require verified `safe_for_copy` facts; central unsupported claims become `needs_research`.
175. Passing drafts create canonical `draft_claim_fact_refs`.
176. Generic offer and CTA language do not require research facts, but company-specific, metric, technical, market, and personalization claims require verified safe facts.
177. Draft claim validation uses agent self-report, deterministic heuristics, and optional advisory LLM classification; uncertainty routes to `needs_review`.
178. Draft claim validation is stored in first-class `draft_claims` and `draft_claim_fact_refs` tables.
179. `draft_claim_fact_refs` is the canonical model for explaining which facts support draft claims.
180. Every `agent_run` stores an `input_snapshot_json` with model policy, entity refs, materialized context, tool allowlist, output schema, and validation rules.
181. Secrets and large raw artifacts do not belong in `input_snapshot_json`; they must be omitted or referenced externally.
182. `agent_runs.output_json` stores raw output, normalized output, validation metadata, and a commit plan.
183. Invalid agent output never mutates domain state.
184. Formatting/schema failures may get one bounded repair attempt; safety/factual failures become workflow-visible outcomes.
185. ADK `LoopAgent` is allowed only for bounded repair loops, with default max repair attempts set to one.
186. Missing facts, safety failures, and ambiguous classifications become structured workflow outcomes, not open-ended repair loops.
187. Agentic stages use `agent_run_outcome` to distinguish normal non-success workflow outcomes from technical failures.
188. `agent_run_outcome` does not equal job status; outcomes like `needs_research` can complete a job successfully while creating follow-up workflow.
189. Every agent outcome must route to an explicit next workflow state.
190. A deterministic `AgentOutcomeRouter` centralizes outcome-to-work-item/command/job/event mapping.
191. `AgentOutcomeRouter` routes by `stage_name + agent_run_outcome` and applies workflow continuation transactionally.
192. ADK stage services do not own workflow routing after output validation.
193. MVP uses a deterministic code-level routing matrix for agent outcomes; it is not UI-configurable in MVP.
194. One `agent_run` maps to one bounded ADK session or execution context.
195. ADK state is temporary and stage-local; Postgres remains product truth.
196. ADK MemoryService is not used as long-term memory in MVP.
197. Draft Review Panel exposes claim safety derived from `draft_claims` and `draft_claim_fact_refs`.
198. Unsupported central company-specific, metric, technical, or market claims block `Approve and Send`.
199. Weakly supported claims warn and require explicit operator confirmation or edit, but do not hard-block by default.
200. `needs_review` claim safety blocks approval until the operator opens and inspects the single draft.
201. State-changing risky claim UI actions map to persisted commands such as research-more, AI revise, manual edit, and remove claim.
202. `Open Sources` is read-only in MVP and does not create a command.
203. Entering manual edit mode is UI-local; saving manual edits creates `request_manual_edit_save`.
204. Removing a claim is modeled as a manual edit save that creates a new draft version.
205. `request_research_more` and `request_ai_revise` remain enqueue-only commands from the review panel.
206. Manual edits and AI revisions always create new draft versions and trigger claim revalidation.
207. `approve_draft_for_send` must validate claim safety for the exact draft version being approved.
208. `Approve and Send` separates operator approval from the external email send side effect.
209. The `approve_draft_for_send` command handler may reserve an `outbound_message` and enqueue `job.send_email`, but must not call Resend.
210. `job.send_email` re-runs final hard guardrails before calling Resend.
211. `outbound_messages` is the durable record for send intent, payload snapshot, provider id, send status, and delivery status.
212. Ambiguous send results are marked `send_ambiguous` and routed to reconciliation/manual handling, not blind retry.
213. Resend provider events update existing outbound messages idempotently and may create suppression state for complaint or hard bounce.
214. Approval alone is not displayed as a sent email in the thread timeline.
215. Resend webhooks are first persisted as `webhook_events`; route handlers do not perform domain processing inline.
216. Inbound email events and provider delivery/status events share the same verify/persist/dedupe/enqueue ingress contract.
217. Webhook dedupe keys prefer provider event id, then provider message id plus event type and timestamp, then canonical body hash.
218. Inbound reply classification runs only after a thread is matched or manually attached.
219. Delivery/status webhook events must update existing outbound messages and must not create new outbound messages.
220. Unmatched provider delivery/status events create reconciliation work items instead of being silently dropped.
221. Complaint, hard bounce, unsubscribe, and manual suppression paths use the same deterministic suppression service.
222. Late weaker delivery events must not downgrade stronger states such as complaint or suppression.
223. Provider events may resolve `send_ambiguous` when they confirm provider acceptance.
224. ADK reply classification must not run against unmatched or ambiguous inbound messages.
225. Inbound thread matching has explicit outcomes: `matched_strong`, `matched_medium`, `ambiguous`, and `unmatched`.
226. Medium-confidence inbound matches may auto-attach only when there is exactly one candidate and no conflict.
227. Ambiguous and unmatched inbound messages create operator-visible work items and do not trigger warm drafting.
228. Manual attach emits a manual thread match event and then allows reply classification.
229. Same-organization new senders can be added as thread participants without creating a new cold thread.
230. Warm draft generation is allowed only for safe reply classes: `positive_interest`, `question`, and `neutral`.
231. `unsubscribe`, `negative`, `wrong_person`, `not_now`, `auto_reply_or_noise`, and low-confidence classifications do not auto-generate warm drafts.
232. Inbox priority order is based on operator action urgency, not entity type alone.
233. Work items use explicit priority bands: `p0_urgent`, `p1_high`, `p2_normal`, and `p3_low`.
234. P0 urgent items may trigger Telegram notifications; Telegram does not mirror the whole Inbox.
235. Complaints, hard bounces, explicit unsubscribes, serious send failures, unresolved ambiguous sends, urgent positive replies, and active compliance blockers are P0.
236. Ambiguous/unmatched inbound, wrong-person reassignment, warm draft review, reply research/review, and unmatched provider events are P1.
237. Cold draft review, cold research needed, contact selection review, and campaign discovery review are P2.
238. Follow-up eligible, deferred not-now resurfacing, and low-priority quality/readiness review are P3.
239. Work items require stable dedupe keys and should update existing open items instead of creating queue noise.
240. Newer state can supersede older work items while preserving auditability.
241. State-changing Inbox actions map to persisted commands; read-only navigation actions do not.
242. Policy enforcement is deterministic and outside ADK.
243. MVP separates suppression, temporary policy state, and per-action guardrail evaluation.
244. Suppression blocks future sending by contact, organization, or domain scope until explicitly removed.
245. Policy state covers cooldown, retry-after, manual hold, manual override, and compliance flag.
246. Guardrail evaluation returns `allow`, `warn_confirm`, or `block` with structured reasons.
247. `job.send_email` must re-check hard guardrails before external side effects.
248. Manual override may bypass warnings or allowed temporary policy states, but not unsubscribe, complaint, hard bounce, compliance hard block, duplicate send conflict, or unsupported central claims.
249. Policy blockers create deduped work items with next valid operator actions.
250. Expired cooldowns, retry-after dates, not-now follow-up eligibility, and expired manual holds resurface as deduped Inbox work.
251. `start_campaign` requires structured readiness fields; incomplete scope stays in `drafting_scope` and creates `campaign_scope_incomplete`.
252. Campaign expansion uses explicit caps for discovery, enrichment, draft concurrency, review backlog, and expansion cadence.
253. One expansion pass performs bounded work and stops; further expansion is triggered by resume/start, backlog thresholds, scheduled ticks, or operator request.
254. Paused campaigns block new cold discovery, cold enrichment, and cold draft generation, but keep review, inbound, warm, compliance, and inspection flows active.
255. `resume_campaign` creates only a bounded expansion tick when capacity allows; it does not replay the original start fan-out.
256. `close_campaign` permanently stops normal cold expansion, supersedes cold expansion work items, and preserves history.
257. Inbound replies after campaign close are still ingested, but warm handling becomes manual/exceptional rather than normal campaign continuation.
258. Campaign status gates commands and jobs deterministically before worker execution starts.
259. Prospect discovery candidates are agent proposals; deterministic domain services decide acceptance, dedupe, policy rejection, or review.
260. Organization dedupe is domain/URL-first, then company/profile matching; weak or conflicting matches require review.
261. Organization enrichment continues automatically to contact selection only when outcome is `enriched`.
262. `research_contact_candidates` are proposals and require deterministic validation before promotion to `contacts`.
263. Cold outreach selects one primary contact per organization; fallback contacts may be stored but are not contacted in parallel.
264. Contact selection cannot select suppressed, do-not-contact, hard-bounced, invalid, or one-active-thread-conflicting contacts.
265. Low-confidence contact selection creates review work and does not silently continue to drafting.
266. `no_actionable_contact` is a workflow outcome, not a technical failure.
267. Referred contacts from `wrong_person` replies require normal contact selection, policy checks, and operator review.
268. Cold draft generation requires active campaign, enriched organization, selected primary contact, policy pass, no active-thread conflict, and usable research snapshot.
269. Organization Detail is a read model assembled from domain tables and event history, not a second CRM truth store.
270. Organization Detail shows company lifecycle, campaign/outreach history, contacts/participants, research, stats, outcomes, timeline, and next action.
271. Organization-level outcome labels are derived from domain state and events, not manually free-typed.
272. Organization timeline is event-log backed and shows business events by default, not job retry noise.
273. Contact candidates must be visually distinct from promoted contacts in Organization Detail.
274. Suppressed contacts remain visible in Organization Detail so skipped decisions are explainable.
275. Organization Detail preserves learning/audit context for future autosend readiness while autosend remains disabled.
276. MVP stores both explicit operator feedback and implicit feedback derived from actions/events.
277. Manual edit severity is classified deterministically and used as a learning signal, not a send blocker.
278. Quality score remains rule-based in MVP and stores reason tags, not only a numeric value.
279. Autosend readiness labels are draft-level annotations only and do not control sending in MVP.
280. Positive learning corpus contains only safe approved/final artifacts and useful successful patterns.
281. Negative learning corpus contains rejected, skipped, major-redo, removed-claim, and safety/problem examples.
282. Neutral/audit-only artifacts are retained but excluded from retrieval by default.
283. Feedback summaries for RAG must retain references to original feedback records.
284. Learning/indexing jobs run in the background and must not block operator review or sending.
285. Any future autosend requires a separate explicit design decision and policy gate.
286. MVP runtime is local-first Docker Compose with `dashboard`, `worker`, and `postgres` services.
287. Dashboard and worker communicate through Postgres and shared service/repository logic, not direct in-memory calls.
288. Dashboard handles SSR, operator commands, and webhook ingress; worker handles jobs, ADK stages, external side effects, and indexing.
289. Product truth lives in Postgres and configured volumes, not ephemeral container files.
290. Secrets come from local environment/secret injection and must not be stored in prompts, agent snapshots, artifacts, event payloads, or committed config.
291. Drizzle migrations and pgvector setup run before app/worker use; worker refuses incompatible schema versions.
292. Health checks cover dashboard, worker, Postgres, schema compatibility, job polling, and required config presence without expensive external API calls by default.
293. Worker uses logical `urgent`, `drafting`, and `background` loops with concurrency caps, lease recovery, and graceful shutdown.
294. Dashboard ops surface shows P0/P1 work, failed/exhausted jobs, stale leases, webhook failures, ambiguous sends, review/research backlog, indexing backlog, and worker heartbeat.
295. Repo must include a local runbook for env vars, compose startup, migrations, webhook testing, failed-job inspection, safe requeue, shutdown, and backup/restore.
296. MVP security model is local-only and single-operator; future multi-user auth requires separate design.
297. Raw sensitive content should be stored once and referenced, not duplicated across events, snapshots, logs, and artifacts.
298. Raw email and webhook payloads are retained for audit but excluded from RAG, logs, and prompts by default.
299. Agent prompts receive minimized materialized context, not unrestricted DB rows, full mailbox history, secrets, or unrelated PII.
300. RAG indexes curated labeled artifacts only; raw emails, raw provider payloads, raw fetch dumps, full contact lists, secrets, and neutral/audit-only artifacts are excluded by default.
301. Logs should use ids, event names, job ids, command ids, and short errors, not full prompts, raw emails, provider payloads, secrets, or long tool outputs.
302. Webhook ingress must verify authenticity, dedupe retries, and avoid sensitive error details.
303. Suppression is not deletion; enough data must remain to enforce do-not-contact and explain decisions.
304. Backups contain sensitive data and must stay outside committed repo files.
305. Verified webhook ingress may run only a minimal idempotent suppression safety fast-path for complaint, hard bounce, and explicit unsubscribe events; all broader provider-event interpretation remains worker-owned.
