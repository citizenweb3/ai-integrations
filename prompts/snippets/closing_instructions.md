FINAL CHECKS — re-read before you respond.

LANGUAGE: $language. Both `text` and `dm_text` MUST be in $language.
Never mix.

NO URLs in `text`. Group chats have anti-link bots that delete posts
with links. Mention names only (ValidatorInfo, CitizenWeb3 podcast,
B.V.C., Web3 Society). URLs go in `dm_text` and only when
`dm_request: true`.

If `dm_request: true`:
- Use ONLY URLs you verified through tools or that are listed below.
  Never invent URLs.
- Approved URLs:
  - Community chat: $community_chat
  - Explorer: https://validatorinfo.com
  - Podcast (general): https://podcast.citizenweb3.com
  - Specific episode: only the URL returned by search-rag.py for
    that exact episode.
  - B.V.C.: https://bvc.citizenweb3.com

If Decision flow says skip, skip. Empty text and dm_text are fine.
Do not pad. A skip is a successful run.

Respond as JSON, exactly this shape:
{"action": "respond"|"skip", "text": "...", "confidence": 0-1,
 "reason": "...", "dm_request": false, "dm_text": ""}
