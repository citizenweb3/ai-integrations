# Agent Research Toolkit — Reusable Discovery Module

**Date**: 2026-04-08
**Status**: Design
**Scope**: Standalone module, reusable across agents (biz-dev, SEO, content, growth)
**IP candidate**: Yes — publish as open-source tool after battle-testing in biz-dev

---

## Problem

AI agents tasked with research (finding companies, people, data) make three predictable mistakes:

1. **Skip tools, hallucinate facts.** The agent "knows" the company does DeFi lending because it sounds right. No verification.
2. **Search the same source multiple times.** Three webread calls to the same domain in one session.
3. **Collect fragments, lose structure.** Found the CEO name on Twitter, tech stack on GitHub, funding on Crunchbase — stored in three separate places, never merged.

These are tool-use problems, not intelligence problems. The fix is a structured toolkit with clear rules.

---

## Architecture

```
┌──���───────────────────────────────────────────────────┐
│                Agent Research Toolkit                  │
│                                                       ��
│  ┌─────────┐  ┌─────────┐  ┌─���───────┐  ┌─���──────┐ │
│  │ webread  │  │ ghsearch│  │ websearch│  │ reddit │ │
│  │ (Jina)   │  │ (gh CLI)│  │ (API)   │  │ (JSON) │ │
│  └���───┬─────┘  └────┬────┘  └───���┬────┘  └───┬────┘ │
│       │              │            │            │      │
│       └──────────────┴────────────┴────────────┘      │
│                       │                               │
│              ┌────────▼────────┐                      │
│              │  Result Merger  │                      │
│              │  + Dedup Engine │                      │
│              └────────┬──────���─┘                      │
│                       │                               │
│              ┌────────▼────────┐                      │
│              │  Entity Store   │                      │
│              │  (SQLite)       │                      │
│              └────────┬────────┘                      │
│                       │                               │
│              ┌────────▼────��───┐                      │
│              │ Confidence Gate │                      │
│              └─────────────────┘                      ���
└─────────���─────────────────────────────���──────────────┘
```

---

## Four Tools

### 1. webread — Read any URL

**Based on**: `consciousness-chain/src/webread.ts`
**Backend**: Jina Reader (`r.jina.ai/URL`)
**Cost**: Free, no API key
**Rate limit**: No hard limit (Jina has soft throttling)

**Capabilities:**
- Read any public web page as clean markdown
- Bypass Twitter/X, Reddit, LinkedIn blocks
- Extract text from JavaScript-rendered pages

**Agent instructions (skill):**
```
## Tool: webread

Read any URL. Returns clean markdown text.

WHEN TO USE:
- Company website → description, team, contacts, tech info
- Twitter/X profile → recent posts, bio, links
- GitHub README → project description, tech stack
- Blog/news article → announcements, funding, team changes
- Any page you need text from

WHEN NOT TO USE:
- Searching for something (use websearch instead)
- Finding repos by topic (use ghsearch instead)
- Scanning multiple Reddit posts (use reddit instead)

CALL FORMAT:
  webread("https://example.com/about")

RETURNS: markdown text of the page (first 200 lines)

RULES:
- ONE call per unique URL per session. Results are cached.
- Extract ALL useful data on first read. Don't re-read the same URL.
- If page returns error or empty → mark source as "unavailable", move to next tool.
```

### 2. ghsearch — Search GitHub repos

**Based on**: `consciousness-chain/src/github-research.ts`
**Backend**: `gh` CLI (GitHub's official CLI)
**Cost**: Free with GitHub auth
**Rate limit**: 30 searches/minute

**Capabilities:**
- Search repos by topic, keyword, language
- Sort by stars, recent creation, recent updates
- Get: name, description, stars, forks, language, license, topics

**Agent instructions (skill):**
```
## Tool: ghsearch

Search GitHub repositories by topic or keyword.

WHEN TO USE:
- Find a company's open-source repos
- Check if a project is actively maintained
- Find tech stack and team from code
- Discover new projects in a niche

WHEN NOT TO USE:
- Reading a specific repo README (use webread instead)
- General web search (use websearch)

CALL FORMAT:
  ghsearch("company-name blockchain")
  ghsearch("DeFi lending protocol", sort="stars", limit=10)
  ghsearch("cosmos SDK", created_days=30)  # new repos only

RETURNS: list of repos with name, stars, description, language, topics

RULES:
- Search ONCE per company. Don't retry with slight variations.
- If no results → the company may not have public repos. That's data, not failure.
- Stars < 10 and no recent commits = abandoned. Note this.
```

### 3. websearch — Web search

**Backend**: WebSearch tool (MCP/API) or free alternatives
**Cost**: Depends on provider
**Rate limit**: Depends on provider

**Capabilities:**
- General web search by query
- Find news, announcements, funding rounds
- Discover contact information, social profiles

**Agent instructions (skill):**
```
## Tool: websearch

Search the web for information. Returns snippets and URLs.

WHEN TO USE:
- Find recent news about a company (funding, launches, partnerships)
- Find contact email when website doesn't have one
- Verify a fact you're unsure about (confidence < 80%)
- Find alternative sources after webread fails

WHEN NOT TO USE:
- You already have the URL (use webread)
- You need GitHub repos (use ghsearch)
- You need Reddit discussions (use reddit)

CALL FORMAT:
  websearch("CompanyName funding round 2026")
  websearch("CompanyName CEO email contact")
  websearch("CompanyName site:linkedin.com")

RETURNS: search results with titles, snippets, URLs

RULES:
- MAX 3 searches per company. If 3 searches don't find it, it's not findable.
- Be specific. "CompanyName" alone wastes a search. "CompanyName CEO email" is better.
- After finding a useful URL in results → use webread to get full content.
```

### 4. reddit — Scan subreddits

**Based on**: `consciousness-chain/src/reddit-scan.ts`
**Backend**: Reddit JSON API (free, no auth)
**Cost**: Free
**Rate limit**: 60 requests/minute

**Capabilities:**
- Scan hot/top posts from configurable subreddits
- Extract titles, scores, comments, flairs
- Find trending topics, questions, discussions

**Agent instructions (skill):**
```
## Tool: reddit

Scan Reddit subreddits for posts and discussions.

WHEN TO USE:
- Find what people say about a company/project
- Discover community sentiment
- Find prospects asking for validators/partners
- Content research for outreach personalization

WHEN NOT TO USE:
- Reading a specific Reddit post (use webread with post URL)
- General search (use websearch)

CALL FORMAT:
  reddit(subs=["cosmosnetwork", "ethereum"], sort="hot", limit=10)
  reddit(subs=["defi"], sort="top", limit=20)

RETURNS: list of posts with title, score, comments, subreddit, URL

RULES:
- Use for discovery/scanning, not for specific company research.
- When a post looks relevant → use webread to get full content + comments.
```

---

## Result Merger + Dedup Engine

Every tool call returns data fragments. The merger:

1. **Normalizes** results into a standard entity format
2. **Deduplicates** by domain/company name — if entity exists, merges new fields
3. **Tracks provenance** — which tool found which field

### Entity format (standard across all agents)

```python
@dataclass
class ResearchEntity:
    id: str                    # cuid
    name: str                  # company/project name
    domain: str | None         # primary website domain
    description: str | None
    tech_stack: list[str]
    stage: str | None          # mainnet, testnet, pre-launch
    tvl: str | None
    funding: str | None
    team_size: str | None
    contacts: list[Contact]    # multiple contacts per entity
    social: dict[str, str]     # twitter, github, discord, telegram
    sources: list[Source]      # provenance: which tool found what
    confidence: dict[str, float]  # per-field confidence 0-1
    raw_data: dict[str, str]   # raw webread/search results for reference
    created_at: str
    updated_at: str

@dataclass
class Contact:
    email: str
    name: str | None
    title: str | None
    source: str               # website, github, apollo, hunter

@dataclass
class Source:
    tool: str                 # webread, ghsearch, websearch, reddit
    url: str
    field_updated: list[str]  # which entity fields this source populated
    timestamp: str
```

### Dedup rules

- Same domain → same entity (merge)
- Same GitHub org → same entity (merge)
- Company name fuzzy match (Levenshtein < 3) → flag for manual review
- Same contact email → link entities (may be same company under different name)

---

## Confidence Gate

Before the agent uses any data field, it checks confidence:

```
Confidence Protocol:
1. Each field has a confidence score (0-1)
2. Fields from official website → 0.9
3. Fields from GitHub → 0.8
4. Fields from search snippets → 0.6
5. Fields from Reddit → 0.4
6. Fields not verified → 0.3

Decision:
- confidence >= 0.8 → use in outreach
- 0.6 <= confidence < 0.8 → use but mark as approximate
- confidence < 0.6 → DO NOT use in outreach, trigger research
- After research, still < 0.6 → mark "unknown", skip this field
```

This is the confidence-gated research pattern from Ivan's TG Growth Agent, formalized as a module.

---

## Entity Store (SQLite)

```sql
CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT,
    description TEXT,
    tech_stack TEXT,           -- JSON array
    stage TEXT,
    tvl TEXT,
    funding TEXT,
    team_size TEXT,
    social TEXT,               -- JSON dict
    confidence TEXT,           -- JSON dict: field → score
    raw_data TEXT,             -- JSON dict: tool → raw output
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE contacts (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    title TEXT,
    source TEXT,
    verified_at TEXT,
    FOREIGN KEY (entity_id) REFERENCES entities(id)
);

CREATE TABLE sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    url TEXT,
    fields_updated TEXT,       -- JSON array
    timestamp TEXT,
    FOREIGN KEY (entity_id) REFERENCES entities(id)
);

CREATE TABLE search_cache (
    url TEXT PRIMARY KEY,
    content TEXT,
    fetched_at TEXT,
    expires_at TEXT             -- cache TTL, default 24h
);
```

### Search Cache

Every webread/websearch result is cached for 24 hours. Agent calling webread on same URL twice in one day gets cached result. Prevents:
- Wasting Jina Reader bandwidth
- Getting rate-limited
- Inconsistent data from different fetches of same page

---

## Orchestration: Research Pipeline

When an agent needs to research a company, it calls the pipeline:

```python
async def research_entity(name: str, domain: str | None = None) -> ResearchEntity:
    entity = load_or_create(name, domain)
    
    # Step 1: Website (always first)
    if domain:
        data = await webread(f"https://{domain}")
        entity = merge(entity, extract_from_website(data), confidence=0.9)
        
        # Try common contact pages
        for path in ["/about", "/team", "/contact"]:
            if entity.contacts:  # already found email, skip
                break
            data = await webread(f"https://{domain}{path}")
            entity = merge(entity, extract_contacts(data), confidence=0.9)
    
    # Step 2: GitHub (always, for tech data)
    repos = await ghsearch(f"{name}")
    if repos:
        entity = merge(entity, extract_from_github(repos), confidence=0.8)
        # Read main repo README for tech details
        if repos[0].url:
            data = await webread(repos[0].url)
            entity = merge(entity, extract_from_readme(data), confidence=0.8)
    
    # Step 3: Web search (fill gaps)
    gaps = find_low_confidence_fields(entity, threshold=0.6)
    if gaps:
        for query in generate_search_queries(entity, gaps):
            results = await websearch(query)
            entity = merge(entity, extract_from_search(results), confidence=0.6)
    
    # Step 4: Email discovery cascade (if no email yet)
    if not entity.contacts:
        # Apollo.io
        contacts = await apollo_search(domain or name)
        if contacts:
            entity = merge(entity, contacts, confidence=0.7)
        
        if not entity.contacts:
            # Hunter.io (last resort)
            contacts = await hunter_search(domain or name)
            if contacts:
                entity = merge(entity, contacts, confidence=0.7)
    
    # Final confidence check
    entity = compute_overall_confidence(entity)
    save(entity)
    return entity
```

---

## Deep Research Skill

When confidence stays below 0.8 after standard pipeline, agent activates deep research:

```
## Skill: deep-research

Triggered when standard pipeline leaves gaps (confidence < 0.8 on critical fields).

PROCEDURE:
1. Identify which fields are low confidence
2. For each gap, run 3 DIFFERENT search queries:
   - "[company] [field] site:crunchbase.com OR site:pitchbook.com"
   - "[company] [field] announcement 2025 OR 2026"
   - "[company CEO/founder name] [field]"
3. For each useful URL found → webread full page
4. Cross-verify: if two sources agree → confidence = 0.8
5. If sources contradict → flag for human review
6. MAX 10 additional tool calls per entity in deep research mode

PITFALLS:
- Don't search the same query twice with minor rewording
- Don't trust a single search snippet as fact (confidence stays 0.6)
- Two independent sources confirming = verified (0.8+)
- If 10 tool calls don't resolve → mark "unknown" and move on
```

---

## Stop-Slop Skill (for outreach writing)

```
## Skill: stop-slop

Check every piece of written text before sending to human for approval.

PROCEDURE:
1. Read the text
2. Check for these AI tells:
   - "I'd be happy to..." / "I hope this finds you well"
   - Filler phrases: "In today's landscape", "It's worth noting"
   - Hedge stacking: "potentially", "arguably", "it seems like"
   - Binary contrasts: "not X, but Y"  
   - Em dashes used as crutch
   - Three-item lists where two would do
   - Sentences starting with "This is" or "Here's"
   - Exclamation marks (max 0 in cold email)
   - More than 1 emoji per email
3. Rewrite flagged phrases
4. Verify: would a human partnership manager write this?
5. If not → rewrite again

PITFALL:
- Don't make it robotic trying to avoid AI tells. Natural > perfect.
```

---

## Module Interface

For any agent to use this toolkit:

```python
from research_toolkit import ResearchToolkit

toolkit = ResearchToolkit(
    db_path="data/entities.db",
    cache_ttl=86400,           # 24h
    jina_enabled=True,
    github_enabled=True,
    apollo_key=os.getenv("APOLLO_API_KEY"),
    hunter_key=os.getenv("HUNTER_API_KEY"),
)

# Research a company
entity = await toolkit.research("CompanyName", domain="company.com")

# Check if data is sufficient
if entity.overall_confidence >= 0.8:
    # Ready for outreach
    pass
else:
    # Deep research
    entity = await toolkit.deep_research(entity)
    
# Search cache prevents duplicate fetches
page = await toolkit.webread("https://company.com/about")  # fetches
page = await toolkit.webread("https://company.com/about")  # cached

# Entity merge handles dedup
toolkit.add_contact(entity.id, email="john@co.com", source="website")
toolkit.add_contact(entity.id, email="john@co.com", source="apollo")  # dedup'd
```

---

## Reusability Matrix

| Agent | webread | ghsearch | websearch | reddit | entity store | confidence gate |
|-------|---------|----------|-----------|--------|-------------|-----------------|
| **Biz-dev** | Yes | Yes | Yes | Rare | Yes | Yes |
| **SEO content** | Yes | Rare | Yes | Yes | Partial | No |
| **TG Growth** | Yes | No | Yes | Yes | No | Yes |
| **Ralph content** | Yes | Yes | Yes | Yes | No | No |
| **Career-Ops** | Yes | Yes | Yes | No | Yes | Yes |

Core tools (webread, websearch) are universal. Entity store + confidence gate are for agents that build profiles.

---

## Implementation Plan

### Phase 1 — Python module (for biz-dev agent)
- [ ] Port webread (Jina Reader) to Python
- [ ] Port ghsearch (gh CLI wrapper) to Python
- [ ] Implement entity store (SQLite + dataclasses)
- [ ] Implement result merger + dedup
- [ ] Implement confidence gate
- [ ] Implement search cache
- [ ] Write agent skills (tool instructions)

### Phase 2 — Battle-test in biz-dev
- [ ] Integrate into biz-dev Docker container
- [ ] Run 100 entity researches, measure accuracy
- [ ] Tune confidence thresholds based on real data
- [ ] Tune dedup Levenshtein threshold

### Phase 3 — Publish as IP
- [ ] Extract into standalone Python package
- [ ] Add CLI interface
- [ ] Add MCP server mode (19 tools like MemPalace)
- [ ] Write documentation
- [ ] Register as IP on Story Protocol via Volem

---

## Dependencies

- `aiohttp` — async HTTP for Jina Reader
- `aiosqlite` — async SQLite
- `subprocess` / `gh` CLI — GitHub search
- Apollo.io SDK (optional)
- Hunter.io SDK (optional)

---

## References

- webread source: `consciousness-chain/src/webread.ts`
- reddit-scan source: `consciousness-chain/src/reddit-scan.ts`
- github-research source: `consciousness-chain/src/github-research.ts`
- Confidence pattern: Ivan's TG Growth Agent (session 36)
- MemPalace: github.com/milla-jovovich/mempalace (entity pages pattern)
- LLM Wiki: Karpathy's compounding knowledge base
- Biz-dev pipeline: `ivan/plans/ai-agents/bizdev-outreach-pipeline-v2.md`
