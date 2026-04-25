VERIFICATION TASK. You wrote a draft response with confidence $initial_confidence. Your confidence was below 0.8, so you MUST now verify it.

ORIGINAL QUESTION: $original_question

YOUR DRAFT: $draft_response

NOW DO THIS:
1) Use python src/tools/query-db.py to check ValidatorInfo database for relevant on-chain data
2) Use WebSearch to find the latest news and facts about this topic
3) Use python src/tools/search-rag.py if podcast content might be relevant

After verification, respond with an UPDATED answer based on what you found. If tools confirmed your draft is accurate, set confidence >= 0.8. If tools showed your draft was wrong or you found no data to verify, set action to 'skip'. Do NOT repeat your draft without verifying. You MUST call at least one tool.

RESPOND IN $language ONLY.
Respond as JSON: {"action": "respond"|"skip", "text": "...", "confidence": 0-1, "reason": "...", "dm_request": false}