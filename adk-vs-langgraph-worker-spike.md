# ADK vs LangGraph Worker Spike

**Date**: 2026-04-25  
**Purpose**: choose whether worker-internal agentic stage flows should use `ADK`, `LangGraph`, or remain plain typed services for MVP

## 1. Context

This spike is explicitly **not** about replacing the system backbone.

The following architecture is already fixed and remains framework-agnostic:

- `commands`
- `jobs`
- `job_runs`
- `event_log`
- `worker_pool`
- `concurrency_key`
- `jobs-as-outbox`
- typed stage services

The only question here is:

**Should specific agentic stage services use a framework internally?**

Examples:

- `CampaignDiscoveryService`
- `OrganizationResearchService`
- `ColdDraftGenerationService`
- `ReplyClassificationService`
- `WarmDraftGenerationService`

## 2. Official framing

### LangGraph

LangGraph describes itself as a low-level orchestration framework and runtime for long-running, stateful agents. Its documented core benefits include:

- durable execution
- human-in-the-loop
- persistence/checkpointing
- memory
- interrupts

Official sources:

- https://docs.langchain.com/oss/python/langgraph/overview
- https://docs.langchain.com/oss/python/langgraph/durable-execution
- https://docs.langchain.com/oss/python/langgraph/human-in-the-loop
- https://docs.langchain.com/oss/javascript/langgraph/persistence

### ADK

Google ADK presents itself as a framework for building, managing, evaluating, and deploying agents. It has explicit workflow-agent primitives and session/state/memory concepts.

Official sources:

- https://google.github.io/adk-docs/get-started/about/
- https://google.github.io/adk-docs/agents/workflow-agents/
- https://google.github.io/adk-docs/agents/workflow-agents/sequential-agents/
- https://google.github.io/adk-docs/agents/workflow-agents/parallel-agents/
- https://google.github.io/adk-docs/agents/workflow-agents/loop-agents/
- https://google.github.io/adk-docs/sessions/state/
- https://google.github.io/adk-docs/sessions/memory/

### Vertex AI Agent Builder

Vertex AI Agent Builder is a broader managed platform. It is relevant for future hosted deployment, but not a good fit for the local/containerized worker runtime we have already chosen.

Official source:

- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/agent-builder/overview

## 3. Evaluation criteria

The framework, if any, must be judged only against worker-internal needs.

### Required criteria

- works inside our `worker` container
- does not replace `commands / jobs / events`
- can coexist with Postgres-backed orchestration
- supports typed stage-local contracts
- supports controlled tool usage
- supports debugging and replayability
- supports human-in-the-loop where needed
- does not force us into a managed runtime

### Nice-to-have criteria

- durable local execution/checkpointing
- easy parallel/subflow composition
- good observability hooks
- clear state model for stage-local memory

## 4. Option A: plain typed services only

### Description

Each stage service is hand-built as application code:

- repositories/services load context
- prompts are assembled manually
- tools are called manually
- outputs are schema-validated manually
- retries/resume stay fully outside in our worker/job model

### Strengths

- maximum control
- no framework lock-in
- minimal abstraction leak
- easiest fit with current architecture
- least hidden magic

### Weaknesses

- more boilerplate
- stage-local loops/parallel subflows have to be hand-written
- no built-in stateful agent runtime primitives

### Best fit

- deterministic stages
- simple single-shot generation/classification
- early MVP if we want minimal adoption risk

## 5. Option B: LangGraph inside stage services

### Description

Use LangGraph only inside selected stage services where durable execution or interruptions are useful.

Examples:

- bounded multi-step research synthesis
- human-interruptible review subflow
- stage-local multi-step draft synthesis

### Strengths

- explicit low-level orchestration model
- durable execution and checkpoints
- interrupts / human-in-the-loop
- clear fit for long-running stateful subflows
- does not require LangChain as full backbone

### Weaknesses

- another runtime/state model to reconcile with our own worker model
- easy to duplicate persistence concepts if used too broadly
- may be overkill for simple single-shot services

### Best fit

- stage-local workflows that need internal steps, resumability, or interrupts
- likely strongest fit if we want framework help without surrendering system orchestration

## 6. Option C: ADK inside stage services

### Description

Use ADK only inside selected stage services for agent workflows and local state/memory handling.

Examples:

- sequential research pipeline
- parallel retrieval + synthesis
- iterative revise loops

### Strengths

- explicit workflow agents: sequential / parallel / loop
- built-in session/state/memory concepts
- clear distinction between workflow control and LLM-based sub-agents
- structured framework for stage-local agent behavior

### Weaknesses

- stronger built-in concepts around sessions/state/memory that may overlap with our own domain/runtime model
- likely more opinionated than we need for some stages
- fit with our Postgres-first orchestration model needs validation in code, not just in docs

### Best fit

- stage-local agent workflows where explicit workflow-agent constructs are valuable
- teams comfortable adopting ADK concepts without letting them leak into top-level orchestration

## 7. Preliminary comparison

### Best fit with our current architecture

1. `Plain typed services`
2. `LangGraph`
3. `ADK`
4. `Vertex Agent Builder` excluded

### Why this ordering

- plain typed services fit immediately and preserve our control
- LangGraph is the closest match if we later need framework support for stage-local orchestration primitives
- ADK is promising, but its built-in session/state/memory model may overlap more heavily with our own runtime abstractions
- Vertex Agent Builder is outside the shape of the current deployment model

## 8. Decision matrix

Scoring scale:

- `5` = strongest fit
- `3` = acceptable with tradeoffs
- `1` = weak fit

| Criterion | Plain typed services | LangGraph | ADK |
|---|---:|---:|---:|
| Fit with current Postgres-backed worker architecture | 5 | 4 | 3 |
| Control over retries/idempotency staying in our system | 5 | 4 | 3 |
| Stage-local durable execution | 1 | 5 | 3 |
| Human-in-the-loop support inside a stage | 2 | 5 | 3 |
| Built-in workflow primitives for multi-step stage logic | 2 | 4 | 5 |
| Risk of framework state model conflicting with our own | 5 | 3 | 2 |
| Boilerplate / speed of first prototype | 3 | 3 | 4 |
| Observability fit with our own DB-centric tracing | 5 | 3 | 3 |
| Risk of framework takeover beyond stage-local scope | 5 | 3 | 2 |

### Reading the matrix

- `Plain typed services` win on architectural fit and control.
- `LangGraph` wins on durable stage-local orchestration and human-in-the-loop.
- `ADK` wins on prebuilt workflow-agent primitives such as sequential / parallel / loop execution.

### Working interpretation

- If the first goal is minimal architectural risk, start with `plain typed services`.
- If the first goal is richer stage-local orchestration with resumability, prefer `LangGraph`.
- If the first goal is rapid workflow-agent composition, ADK is attractive, but only if its session/state model does not fight our own runtime model in practice.

## 9. Recommendation for next step

Do **not** choose based only on documentation.

Run a small implementation spike with one representative stage.

### Suggested spike candidates

Pick one of:

- `ReplyClassificationService`
- `OrganizationResearchService`
- `WarmDraftGenerationService`

These are good spike candidates because they are:

- meaningfully agentic
- bounded enough to compare implementations
- important to product quality

## 10. Spike plan

Implement the same representative stage in three ways:

1. plain typed service
2. LangGraph-backed stage-local flow
3. ADK-backed stage-local flow

Measure:

- integration complexity
- fit with existing worker/job model
- schema validation ergonomics
- observability/debuggability
- stage-local state handling
- how much framework state leaks into system architecture

## 11. Current recommendation

Until the spike is complete:

- keep the top-level worker architecture framework-agnostic
- keep stage contracts typed
- do not over-design deep worker-agent internals
- do not commit to ADK or LangGraph yet

If forced to choose today without the spike:

- choose **plain typed services first**
- consider **LangGraph second**
- evaluate **ADK** only after confirming its state/session model does not fight our own Postgres-centric orchestration

## 12. Practical orchestration recommendation right now

Until the spike is completed, the working rule should be:

- top-level system orchestration stays custom and Postgres-backed
- stage-level agent orchestration stays intentionally thin
- no stage should assume ADK or LangGraph-specific runtime semantics yet
- only the spike stage may use a candidate framework experimentally
