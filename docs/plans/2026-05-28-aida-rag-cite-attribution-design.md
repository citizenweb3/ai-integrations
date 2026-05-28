# Aida — RAG cite/recommend attribution split

**Date:** 2026-05-28
**Branch:** `telegram-growth-agent-vertex`
**Status:** Design locked.

---

## 1. Problem

Aida pushes "CW3 podcast" too aggressively. Root cause: `search_rag` returns
quote + speaker + episode title + URL, and the current prompt (§6, §7) tells
her to "mention the podcast by name" as Rung 2 promotion. So every grounded
answer ends up branded:

> "В CW3 подкасте 'Episode 137: Sovereignty' Anatoly Yakovenko сказал..."

Two functions collide: the quote is **evidence** (grounding the answer) and
**promotion** (Rung 2 product mention) at the same time. The promotional
weight makes evidence cites read as marketing.

Worst case: speaker is a CW3 host (Serge Vagaytsev, Anna Sherman). Aida
packages an internal voice as neutral external evidence — a trust hit when
the user later googles and connects the dots.

---

## 2. Design

Split podcast usage into two **explicit modes** and key disclosure off the
RAG response's `speakerRole` field, which already exists in the API contract.

### 2.1 Two modes

| Mode | Triggered when | Attribution |
|---|---|---|
| **Cite** (default) | Aida pulls a quote via `search_rag` to ground her own claim | `"слушала подкаст с <speaker>, он сказал: <quote>"` — no CW3, no podcast brand |
| **Recommend** | User explicitly asks for the resource ("где послушать", "пришли подкаст", "any episode about X") | `"CitizenWeb3 podcast, эпизод про <topic>"` — full naming, URL via `dm_text` if requested |

When unsure → cite. Recommend is upgrade-on-request, not the default.

### 2.2 HOST disclosure

If `speakerRole == "HOST"` (or the speaker is otherwise CW3-affiliated), Aida
must add an explicit affiliation marker even in cite mode:

> "слушала подкаст, там Serge из Citizen Web3 говорил..."

She does **not** name the podcast brand in this case either — the disclosure
is about the *speaker*, not the *show*. Recommend mode is unchanged
(full naming as usual).

Speaker name verbatim. Topic paraphrased to a noun phrase ("about
governance", "про PoS centralization"), never carrying a "CW3" or
"CitizenWeb3" prefix.

### 2.3 Why prompt-only (no code guard)

A regex post-filter that rejects drafts containing "в CW3 подкасте" was
considered and rejected. Reasons:

- Quotes are speaker's words. A guest may legitimately say "CitizenWeb3"
  inside their own quote — a regex would mangle it.
- Episode titles need *paraphrase*, not strip. Title `"CW3 #142: PoS"` becomes
  `"эпизод про PoS"` — semantic rewrite, not substring delete.
- Cite-vs-recommend detection is user intent. Brittle to encode in code.
- Single source of truth in `prompts/system.md`. Drift through duplication
  in code is a known maintenance hazard.

The one *small* code change we do make is rendering `speakerRole` to the
LLM (currently dropped) — this is data plumbing, not policy.

---

## 3. RAG API contract — verified, no changes needed

`validatorinfo/src/app/api/rag/search/helpers.ts:13-29` already exposes:

```ts
export interface RagSearchResult {
  quote: string;
  context: string | null;
  speakerRole: string;          // 'GUEST' | 'HOST' | 'ALL'
  speakerName: string | null;
  validatorId: number | null;
  validatorMoniker: string | null;
  mentionedEntities: string[];
  episodeTitle: string;
  episodeUrl: string;
  similarity: number;
}
```

`ai-integrations/src/ai/tools.py:113` currently renders only `speakerName` +
`episodeTitle` + `episodeUrl`, dropping `speakerRole`. The fix is to include
the role in the LLM-visible string.

No changes required in the validatorinfo repo.

---

## 4. Changes

| File | Edit |
|---|---|
| `prompts/system.md` §5 Rung 2 | Note: podcast naming = Rung 2 **only** in recommend mode |
| `prompts/system.md` §6 CitizenWeb3 Podcast block | Split rendering rules by mode + HOST disclosure |
| `prompts/system.md` §7 search_rag block | Rendering instructions (cite default, recommend on user request, HOST disclosure) |
| `prompts/system.md` §9 NEVER list | Add: "в CW3 подкасте", "CitizenWeb3 podcast", "на подкасте CW3" |
| `src/ai/tools.py` `_search_rag_tool` (`:99-114`) | Pull `speakerRole` from result dict, render `Speaker: <name> (<role>)`. If role missing/empty → render without parens (graceful degrade) |
| `tests/test_tools_rag.py` | Fixture gets `speakerRole: "GUEST"`. New test `test_search_rag_renders_host_role` asserts `(HOST)` in output. New test for empty/missing `speakerRole` graceful degrade |

### 4.1 Out of scope

- `validatorinfo` repo — RAG API already returns `speakerRole`.
- `src/ai/rag.py` — `speaker=` filter parameter stays unused. Default
  behaviour (all roles in result) is correct for the cite use case;
  disclosure is applied per-result by the LLM, not by filtering at fetch.
- `src/core/response_pipeline.py` — no post-filter guard (see §2.3).
- `config.yaml` — scope shift (money chains / validator chats / dev
  chats / signal pipeline) is a **separate task**, tracked separately.

### 4.2 Atomicity

One commit, one stage. The three changed files
(`prompts/system.md` + `src/ai/tools.py` + `tests/test_tools_rag.py`) are
semantically coupled:

- the prompt instructs the LLM to use `(HOST)`/`(GUEST)`,
- the code passes the field through,
- the test guards rendering regression.

Splitting them would land the repo in a broken state between commits.

---

## 5. Verification

### 5.1 Unit
- `pytest tests/test_tools_rag.py` — three tests pass (existing + new HOST +
  new graceful-degrade).
- Existing tests in the file (`test_search_rag_empty`,
  `test_search_rag_error_returned`) must still pass — fixture extension
  only adds a field, doesn't change shape.

### 5.2 Manual smoke (real-creds)
1. Start the responder in approval mode against a controlled seed message
   touching a topic that triggers `search_rag` (e.g. governance theatre,
   centralization, validator decentralization).
2. Inspect the draft. Confirm:
   - No "CW3 podcast" / "CitizenWeb3 подкаст" in `text`.
   - Speaker named verbatim.
   - If `(HOST)` shows up in tool log → draft includes "из Citizen Web3"
     marker.
3. Run a second message that **does** ask for a podcast link
   ("can you send a podcast about X"). Confirm draft uses full
   "CitizenWeb3 podcast" naming and `dm_request=true` with URL in `dm_text`.

No automatic verification of the LLM's output — this is a prompt-shape
contract. The unit test only guards the data-plumbing.

---

## 6. Risk

| Risk | Mitigation |
|---|---|
| LLM ignores prompt rule, ships "CW3 podcast" anyway | Manual smoke. Approval mode (`strategy.mode: "approval"`) catches it before sending. If repeatedly broken — escalate to post-filter guard (revisit §2.3 decision). |
| `speakerRole` field renamed in RAG API | Test for empty/missing → graceful degrade. Code does not assume the field exists. |
| New HOST hire whose name doesn't pattern-match | API-side decision (validatorinfo) — outside this repo. We trust the contract. |
| Recommend-mode triggered too liberally (Aida finds "send the podcast" implicit) | Prompt rule says "explicit ask". When unsure → cite. Approval flow catches over-eager recommends. |
