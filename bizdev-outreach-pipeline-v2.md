# Biz-Dev Outreach Pipeline v2

**Date**: 2026-04-07
**Status**: Design approved
**Supersedes**: bizdev-outreach-pipeline.md (v1)
**Brain task**: #89 (agent debugging), biz-dev related

---

## Overview

Automated cold outreach pipeline for Citizen Web3 and ValidatorInfo. Agent finds prospects, researches them, writes personalized emails, Ivan approves via Telegram, agent sends through Resend. All emails stored with vector embeddings for self-improving quality.

## Two Pillars

### Staking Growth
VCs, foundations, DAOs, high-net-worth stakers. Goal: migrate delegations to CW3 bare-metal, privacy-first, renewable-energy validators. Target: $10M+ TVL growth.

### AI Workforce
Projects, explorers, wallets, DAOs with $1M+ TVL. Goal: sell the architecture of autonomous AI agents (ValForge + specialized agents for Biz Dev, SEO, SMM, DevOps, development, review). ValidatorInfo as live flagship.

---

## Email Infrastructure

### Outbound: Resend API
- Address: `partner@citizenweb3.com`
- Tier: free (100/day), 50 emails/day initial target
- DNS: Cloudflare — SPF/DKIM/MX via Resend-Cloudflare integration
- Tracking: opens and clicks via Resend API polling

### Inbound: Resend Inbound + Cloudflare Email Routing
- Replies to `partner@citizenweb3.com` handled by two systems in parallel:
  - **Cloudflare Email Routing** → forwards to Ivan's personal email (human copy)
  - **Resend Inbound** → webhook `email.received` → agent stores reply in DB + notifies Ivan in Telegram
- Ivan replies through Telegram bot → agent sends via Resend → thread stays on `partner@citizenweb3.com`

### DevOps Setup (separate instruction document)
1. Resend: create account → add domain citizenweb3.com → authorize Cloudflare → get API key
2. Cloudflare DNS: verify SPF/DKIM/MX added automatically, no conflicts
3. Cloudflare Email Routing: activate → rule partner@citizenweb3.com → forward to personal email
4. Resend Inbound: configure webhook URL pointing to our endpoint
5. Docker: add bizdev container to compose, expose webhook port
6. Nginx: proxy webhook endpoint
7. SSL: certbot for webhook endpoint

---

## Prospect Discovery — Cascading Search + Enrichment

For each prospect, agent runs all steps. Stops searching for email once found, but always collects company data.

1. **Website** (webread) → description, tech stack, stage, team, contacts page **+ email if found**
2. **GitHub** (github-research) → activity, contributors, MAINTAINERS.md **+ email if not yet found**
3. **Apollo.io** API → funding, company size, contacts **+ email if not yet found**
4. **Hunter.io** API → **email only**, last resort

All data written to `prospects.db` immediately. Multiple emails per company saved to `prospect_contacts` table — outreach sent to all found contacts.

### Deduplication
Before searching: check if domain/company already exists in prospects.db. Skip if found.

### Confidence Protocol
Before stating any fact about a prospect:
1. Rate confidence 0-100%
2. If < 80% → use webread/search/ValidatorInfo to verify
3. After research, still < 80% → mark field as "unknown"
4. Never guess company details in outreach emails

---

## Data Sources

| Source | Purpose |
|--------|---------|
| **prospects.db** (SQLite) | Pipeline, contacts, statuses, research, emails, threads |
| **ValidatorInfo DB** (PostgreSQL, read-only) | APR, TVL, validator stats, chain data for comparisons |
| **ValidatorInfo RAG API** (`/api/rag/search`) | Podcast quotes, industry leader positions, CW3 context |
| **Email embeddings** (sqlite-vec, embeddinggemma-300m) | Semantic search over past emails for quality improvement |

---

## Pre-Draft Pipeline

Before writing any email, agent MUST:

1. **Vector search** past emails → find similar pillar + similar company
2. **Analyze** what worked (sent/opened/replied/success) and what didn't (edited/redone/skipped)
3. **Check research data** from prospects.db (collected during cascading search)
4. **If gaps** → websearch + ValidatorInfo RAG + ValidatorInfo DB
5. **Confidence >= 80%** → proceed to draft
6. **Confidence < 80%** → Telegram notification with reason + buttons: 📨 Send Generic / ❌ Skip

---

## Drafting

### First Draft: Sonnet
Uses: pillar template + research data + ValidatorInfo stats + RAG quotes + past email analysis.

### Email Templates

**Staking Growth:**
```
Subject: Moving $X from centralized validators? Privacy-first bare-metal option

Hi team,

We run non-custodial, renewable-energy, off-grid bare-metal validators on [Chain]. 
Many privacy-focused funds and DAOs are quietly moving delegations to us for 
sovereignty and transparency.

I've prepared a 60-second custom comparison showing projected rewards vs your 
current setup.

Open to a quick call next week?
```

**AI Workforce:**
```
Subject: We built a complete autonomous AI workforce inside a blockchain explorer 
— want one for your project?

Hi [Name],

ValidatorInfo.com is now powered by a full team of autonomous AI agents (ValForge 
as the sovereign pioneer + specialized agents handling Biz Dev, SEO, SMM, content, 
DevOps, development, review, and more).

We design and integrate this exact architecture for other projects, DAOs, wallets, 
and explorers. Typical timeline: 4-6 weeks from custom design to live agents.

I've analyzed [Your Project] and already spotted 3-5 roles our AI workforce could 
automate for you immediately.

Worth 10 minutes to see the full system in action?
```

### Agent Skills
- **Stop-slop**: check every email before approval. Remove AI tells, hype, filler phrases. Emails must sound human-written.
- **Deep research**: when confidence < 80%, run full multi-source research with cross-verification before drafting.

### Brand Voice
Professional, value-first, zero hype, max 1-2 emojis, data-driven, pro-decentralization. Target audience: validators, node operators, staking platforms, chain teams, explorers, wallets.

---

## Telegram Approval (aiogram)

### Batch Notification
```
📦 Batch #3 (14:00 UTC) — 8 drafts

1. CompanyA | Staking Growth
   → john@company.com
   Subject: Moving from centralized validators?

2. CompanyB | AI Workforce
   → sarah@companyb.io
   Subject: Autonomous AI workforce for CompanyB

3. CompanyC | Staking Growth
   → team@companyc.com
   Subject: Privacy-first bare-metal option

...

👍 Approve All  📋 Review One-by-One
```

### Single Email Review
```
📧 Staking Growth | CompanyName
To: john@company.com, sarah@company.com
Subject: ...

[full email body]

---
🔍 Cosmos SDK, mainnet, TVL $12M
📊 Sources: website, github, apollo
📝 Based on 3 similar successful emails

👍 Send  ✏️ Edit  🔄 Redo  ❌ Skip
```

### Low Confidence
```
⚠️ CompanyName — not enough data for quality draft
Reason: website down, empty GitHub, unknown TVL

📨 Send Generic  ❌ Skip
```

### Reply Received
```
📨 Reply from CompanyName (john@company.com)
Subject: Re: CW3 bare-metal validation

[preview 2-3 lines]

💬 Draft Reply  📖 Read Full  ⏸️ Handle Manually
```

### Actions
- **👍 Send** — send as-is via Resend
- **✏️ Edit** — Ivan writes what to fix, Sonnet applies small changes. If Opus was used before, Opus continues.
- **🔄 Redo** — Opus rewrites from scratch with full context. All further Edit/Redo also through Opus.
- **❌ Skip** — skip prospect
- **📨 Send Generic** — send template without personalization (low confidence)
- **👍 Approve All** — approve entire batch

After Edit and Redo — same four buttons again. Loop until Send or Skip.

### Daily Digest
```
📊 Daily Stats
Sent: 47 | Opened: 23 (49%) | Replied: 3
🔥 Hot leads: CompanyA (opened 3x), CompanyB (replied)
```

---

## Tracking

- On send: save `resend_email_id` in emails table
- Cron (hourly): poll Resend API `/emails/{id}` for open/click status
- Update statuses: sent → opened → replied
- Resend Inbound webhook: catch replies, store full body in `email_threads`
- Daily digest in Telegram

---

## Database Schema

### prospects
```sql
CREATE TABLE prospects (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  website TEXT,
  source TEXT,              -- webread, github, apollo, hunter, manual
  source_url TEXT,
  pillar TEXT,              -- staking_growth, ai_workforce
  description TEXT,
  tech_stack TEXT,
  stage TEXT,               -- mainnet, testnet, pre-launch
  tvl TEXT,
  funding TEXT,
  team_size TEXT,
  status TEXT DEFAULT 'new',
  created_at TEXT,
  updated_at TEXT
);
```

### prospect_contacts
```sql
CREATE TABLE prospect_contacts (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  title TEXT,
  source TEXT,              -- website, github, apollo, hunter
  FOREIGN KEY (prospect_id) REFERENCES prospects(id)
);
```

### emails
```sql
CREATE TABLE emails (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  pillar TEXT,
  version INT DEFAULT 1,
  model TEXT,               -- sonnet, opus
  subject TEXT,
  body TEXT,
  ivan_feedback TEXT,       -- what Ivan wrote on Edit
  status TEXT,              -- draft, edited, redone, sent, opened,
                            -- replied, success, skipped, generic_sent
  resend_email_id TEXT,
  created_at TEXT,
  sent_at TEXT,
  opened_at TEXT,
  replied_at TEXT,
  FOREIGN KEY (prospect_id) REFERENCES prospects(id),
  FOREIGN KEY (contact_id) REFERENCES prospect_contacts(id)
);
```

### email_embeddings
```sql
CREATE TABLE email_embeddings (
  email_id TEXT PRIMARY KEY,
  embedding BLOB,           -- 768-dim float32 via embeddinggemma-300m
  FOREIGN KEY (email_id) REFERENCES emails(id)
);
```

### email_threads
```sql
CREATE TABLE email_threads (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  direction TEXT,           -- outbound, inbound
  subject TEXT,
  body TEXT,
  in_reply_to TEXT,         -- email_id or thread_id this replies to
  resend_email_id TEXT,
  received_at TEXT,
  created_at TEXT,
  FOREIGN KEY (prospect_id) REFERENCES prospects(id),
  FOREIGN KEY (contact_id) REFERENCES prospect_contacts(id)
);
```

---

## Schedule

```yaml
schedule:
  work_start: "09:00"
  work_end: "19:00"
  batch_size: 8
  batch_interval: "1h"
  timezone: "UTC"
```

- 10 working hours/day
- 8 drafts per batch, 1 batch per hour
- 80 drafts/day capacity (with room for skips under 100 send limit)
- Sleeps outside working hours
- Wakes next day at same time

---

## State Machine

```
new
  → researching (cascading search + enrichment)
  → researched
  → drafting (pre-draft pipeline + Sonnet)
  → draft_ready → Telegram batch notification
    → approved (👍 / Approve All) → sent → opened → replied
    → edited (✏️) → draft_ready
    → redone (🔄 Opus) → draft_ready
    → skipped (❌)
  → low_confidence → Telegram notification
    → generic_sent (📨) → sent
    → skipped (❌)
  → sent → no_open_7d → retry or closed
  → replied → Draft Reply (Opus) → Ivan approves → reply_sent
```

All transitions logged in DB.

---

## Runtime

Single Docker container:
- **aiogram bot** (always-on): Telegram approval interface
- **cron**: batch cycle every hour (find → draft → send-pending → track)
- **aiohttp**: webhook endpoint for Resend Inbound
- **SQLite**: prospects.db with all tables, persistent volume

### Environment Variables
```
RESEND_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID          # Ivan
VALIDATORINFO_DB_URL      # read-only PostgreSQL
VALIDATORINFO_RAG_TOKEN   # /api/rag/search auth
APOLLO_API_KEY
HUNTER_API_KEY
```

---

## MVP Scope

### In
- [ ] Resend + Cloudflare setup (DevOps instruction)
- [ ] Resend Inbound webhook for replies
- [ ] Docker container: aiogram + cron + webhook
- [ ] Cascading email discovery (webread → GitHub → Apollo → Hunter)
- [ ] Company enrichment during search
- [ ] prospects.db with full schema
- [ ] Sonnet cold drafts with pillar templates
- [ ] Opus redo on request
- [ ] Telegram approval: batch + single review + Edit/Redo/Skip
- [ ] Stop-slop skill in agent prompt
- [ ] Deep research skill in agent prompt
- [ ] Confidence protocol (>80%)
- [ ] Email embeddings (embeddinggemma-300m) for self-improving quality
- [ ] Open tracking via Resend API polling
- [ ] Reply capture via Resend Inbound
- [ ] Ivan replies through bot (keeps thread on partner@cw3)
- [ ] Daily digest in Telegram
- [ ] ValidatorInfo DB read-only access
- [ ] ValidatorInfo RAG API access
- [ ] 8 emails/hour, 10 hours/day, UTC schedule

### Out (V1)
- Warm email automation (agent drafts warm replies)
- Follow-up sequences (5/12/20 day auto-drafts)
- HTML email templates with CW3 branding
- PDF proposal generation
- A/B testing subject lines
- Twitter/TG/Discord/LinkedIn DMs
- Authority pillar (ValidatorInfo link replacement)
- Resend Pro upgrade
- Webhook-based tracking (vs polling)

---

## Dependencies

- `resend` — email API (Python SDK)
- `aiogram` — Telegram bot framework
- `aiohttp` — webhook HTTP server
- `aiosqlite` — async SQLite
- `embeddinggemma-300m` — local embeddings (node-llama-cpp or Python equivalent)
- `asyncpg` — ValidatorInfo DB read-only access
- Apollo.io API account
- Hunter.io API account
- Cloudflare DNS (citizenweb3.com)
- Docker + nginx

---

## References

- v1 design: ivan/plans/ai-agents/bizdev-outreach-pipeline.md
- TG Growth Agent: /Users/user/project/dev/telegram-growth-agent
- ValidatorInfo RAG: /api/rag/search endpoint
- Resend docs: resend.com/docs
- Resend Inbound: resend.com/docs/knowledge-base/how-can-i-receive-emails-with-resend
- Brain lessons: #123 (Hermes patterns), #119-120 (Career-Ops)
