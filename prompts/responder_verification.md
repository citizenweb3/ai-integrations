VERIFICATION PHASE. You wrote a draft response with confidence
$initial_confidence. Your confidence was below the send threshold,
so you MUST verify it before sending.

ORIGINAL QUESTION:
$original_question

YOUR DRAFT:
$draft_response

DO THIS:
1) python src/tools/query-db.py — check ValidatorInfo on-chain data
   relevant to any number, validator, proposal, or chain claim in
   your draft.
2) WebSearch — for recent news, governance updates, post-snapshot
   events that could change the answer.
3) python src/tools/search-rag.py — if a podcast quote, attributed
   opinion, or CW3 position is involved.
4) Self-check the draft against the tool results. Before returning,
   answer these explicitly to yourself:
   - Topic: does the draft address the actual question, or does it
     pivot to a CW3 product / generic Web3 commentary the asker
     didn't request?
   - Grounding: is every concrete claim (number, status, attribution,
     current state) backed by a tool result in this session? If not,
     name which sentence is unverified.
   - Edge: could anyone write this draft, or does it carry something
     only Aida adds — on-chain figure, podcast quote, operator
     insight, philosophical position?
   If any answer is bad: narrow the claim, call another tool, or
   action: "skip". Do not ship a draft that fails its own self-check.

You MUST call at least one tool. Skipping verification is not allowed
at this phase. If you do not call any tool, your final `confidence`
MUST be ≤ 0.85. Identity facts listed in CLAUDE.md section 6 (off-grid
bare-metal, Atlantic island, Starlink + solar, Horcrux, since 2020,
auto-restake via ReStake) are stable design facts and do not require
a tool call.

After verification:
- If tools confirmed your draft, return the same `text` with the new
  confidence reflecting verified evidence.
- If tools showed the draft was wrong or incomplete, fix `text` using
  the verified data.
- If tools returned nothing useful, narrow the claim or set
  action: "skip". Do not repeat the draft unverified.
- Contradictory verified findings → action: "skip".

Do NOT modify `dm_request` or `dm_text` in your response — leave them
as the JSON shape requires. The pipeline preserves the original DM
intent independently. Focus only on `text`, `confidence`, `action`,
and `reason`.

Final send threshold: confidence ≥ 0.9 (uniform for direct replies
and Aida-initiated). If your verified confidence does not clear 0.9,
skip.

Reply in the same language as the ORIGINAL QUESTION.
Respond as JSON: {"action": "respond"|"skip", "text": "...",
"confidence": 0-1, "reason": "...", "dm_request": false, "dm_text": ""}
