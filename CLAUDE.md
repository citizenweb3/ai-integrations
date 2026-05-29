<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bizdev-email-agent** (681 symbols, 1583 relationships, 46 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/bizdev-email-agent/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bizdev-email-agent/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bizdev-email-agent/clusters` | All functional areas |
| `gitnexus://repo/bizdev-email-agent/processes` | All execution flows |
| `gitnexus://repo/bizdev-email-agent/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## CLI

- Re-index: `npx gitnexus analyze`
- Check freshness: `npx gitnexus status`
- Generate docs: `npx gitnexus wiki`

<!-- gitnexus:end -->

---

## ClawMem — Semantic Code Memory

> ⚠️ Not indexed yet. Add to `~/.config/clawmem/index.yml` to enable.

**When indexed:** use `memory_retrieve` MCP tool before code searches and `reindex` after each commit.

---

# Implementation Protocol

Applies when a task is a **feature or touches 3+ files**. For smaller changes
(1-2 files, typo, question, research-only), skip this protocol and work normally.

## Preconditions (first step)
- **git**: if the repo is under git, the commit rule is active. If not, skip
  commits and note `Commit: N/A (no git)` in the diary.
- **clawmem**: check the index (`index_stats` / `status`). If not indexed, index
  it first (`reindex`; add the project to `~/.config/clawmem/index.yml` if
  needed), then continue. If indexing is impossible, mirror the durable summary
  into the diary with `clawmem: N/A`.

## 1. Prior-art search (before planning)
Search whether this was built or researched before — including by other agents
in other projects (clawmem covers all indexed collections simultaneously):
- **clawmem**: `search` / `intent_search` for direct matches;
  `find_similar` for semantically close patterns;
  `kg_query` / `find_causal_links` for graph-based cross-project discovery
- **git**: `git log --grep` and `git log -S`
- **tasks**: grep past diaries in `.tasks/`

Record findings in the diary. If a similar feature exists in another project,
reuse or adapt — note what was borrowed and why.

If a brainstorm precedes the work, run this same search during the brainstorm
too — the findings sharpen the design doc. This does not replace the
pre-planning search; do both.

## 2. Diary (`.tasks/`, gitignored)
Create `.tasks/YYYY-MM-DD-<slug>.md` first. One file per task. The agent only
creates and appends — it never deletes (the human cleans manually).

Structure:
- **Plan**: checklist of tickets (T1, T2, …)
- **Prior art**: clawmem / git / tasks findings + conclusion
- **Per ticket on close**: what done, how, deviations from plan + why, research,
  commit hash (if git), clawmem id

## 3. Stages & commits
A **stage = an atomic, revertable unit** that can be described as one change.
Group tickets into a stage by this criterion, not by ticket count.

On closing a stage → commit. The message is detailed and natural, the way a
person writes it:
- **what** changed (files / modules)
- **why** (the problem it solves)
- **how** (approach, key decisions)
- **deviations** from plan, and research if it shaped the decision

The commit message MUST stay sterile: no task slug, no clawmem id, no mention of
`.tasks/`, clawmem, or this protocol, and no `Co-Authored-By` / "Generated with"
trailer. The commit is the only artifact that leaves the machine.

## 4. clawmem (per stage + final)
- **Per stage**: a durable entry mirroring the commit content (what / how /
  deviations / research) plus the commit hash.
- **On task completion**: pin a final summary (`memory_pin`) — outcome, key
  decisions, pitfalls. This survives diary cleanup and is what the next task's
  prior-art search finds.

## 5. The linked graph (wiring lives on the private side only)
Join key = **commit hash** (a hash reveals nothing about the system).
- diary ticket stores: commit hash + clawmem id
- clawmem entry stores: commit hash + task slug
- commit stores: nothing pointing back

From any node, reach the other two via the hash. The commit stays clean; the
working artifacts (slug, ids, diaries) never leave the machine.

## Team mode

Triggered only when the user explicitly requests team work (or `/team-feature-development`).
Without an explicit request, work single-agent — the protocol above as written.

In team mode the protocol roles redistribute:

| Protocol element | Single-agent | Team mode |
|---|---|---|
| Prior-art search | the agent | the lead, once, in the brainstorm/planning phase |
| Diary (`.tasks/`) | the agent | the lead owns the master diary; teammates report stage results, the lead records them |
| Stage = atomic commit | agent commits sequentially | each teammate commits their own atomic stages in parallel, within their file-ownership boundary (no two teammates touch the same file) |
| Verification | the agent (+ human) | the lead: review-with-scoring (finder ≠ judge) + a verification pass |
| clawmem per stage + final pin | the agent | teammates write per-stage entries; the lead writes the final `memory_pin` |

**Milestone vs stage.** A stage is one teammate's atomic revertable commit (fine-grained,
parallel, no gate). A milestone is an integration point where several teammates' parallel
work converges into something coherent. The lead defines milestones in the plan, before
spawning the team.

**Milestone cycle (the human gate):**
1. the lead hands the milestone's parallel tasks to teammates
2. teammates work in parallel, committing their atomic stages
3. teammates report completion to the lead
4. the lead runs review-with-scoring + verification on the milestone
5. the lead records the milestone in the master diary + clawmem
6. the lead STOPS, shows the milestone result to the human, waits for approval
7. approval → next milestone; otherwise → fixes within the current milestone

Parallelism stays within a milestone; milestones are serialized by the human gate. If the
feature is a single milestone, there is one gate, at the end before merge. The commit
sterility rule and the linked-graph wiring are unchanged.
