# Telegram Growth Agent — Aida

Autonomous Telegram agent for CitizenWeb3. Joins Web3/staking/privacy groups, answers questions with real data from ValidatorInfo + CW3 podcast RAG, and grows the community.

## Prerequisites

- Docker + Docker Compose
- Claude Max subscription (for `claude -p` CLI)
- Telegram account (for user session)
- ValidatorInfo instance (optional, for on-chain data + RAG)

## Setup

### 1. Get Telegram API credentials

Go to [https://my.telegram.org/apps](https://my.telegram.org/apps), create an application. You get:

- **API ID** (number)
- **API Hash** (string)

### 2. Create approval bot

Open [@BotFather](https://t.me/BotFather) in Telegram:

```
/newbot
```

Save the **bot token**.

For **approval chat ID**: create a group, add the bot (make it admin), add `@getmyid_bot` to get the group ID, then remove `@getmyid_bot`.

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in `.env`:

```
TELEGRAM_API_ID=<from step 1>
TELEGRAM_API_HASH=<from step 1>
TELEGRAM_BOT_TOKEN=<from step 2>
APPROVAL_CHAT_ID=<group chat ID from step 2>
```

### 4. Get Claude Code auth

You need a Claude Max subscription. Get your OAuth token:

```bash
claude auth token
```

Get account details from `~/.claude.json` and add to `.env`:

```
CLAUDE_CODE_OAUTH_TOKEN=<token>
CLAUDE_ACCOUNT_UUID=<from ~/.claude.json>
CLAUDE_EMAIL=<from ~/.claude.json>
CLAUDE_ORG_UUID=<from ~/.claude.json>
```

### 5. Configure ValidatorInfo connection (optional)

If running alongside ValidatorInfo:

```
RAG_API_TOKEN=<shared token, must match ValidatorInfo .env>
RAG_API_URL=<ValidatorInfo URL>
DATABASE_URL=<ValidatorInfo PostgreSQL connection string>
```

### 6. Build and generate session

```bash
docker compose build
docker compose run --rm tg-growth-agent python scripts/generate-session.py
```

Enter your phone number and SMS code. Copy the output `TELEGRAM_SESSION=...` into `.env`.

### 7. Start

```bash
docker compose up -d
```

Check logs:

```bash
docker compose logs -f
```

You should see:

```
Logged in as: Aida (@username, id=...)
RAG API: connected
ValidatorInfo DB: connected
Listener started in RESPOND mode
Agent running
```

### 8. Join groups

Log into the Telegram account and join target groups manually. The agent will register them automatically when messages start coming in. New groups enter a 3-6 hour warmup period before the agent starts responding.

## How it works

### Reactive responses
1. **Listener** monitors groups for staking/privacy keywords
2. **Claude** generates a response using tools (ValidatorInfo DB, RAG, web search)
3. **Two-phase verification**: if confidence 0.6-0.79, Claude runs a second pass with mandatory tool use. Only responses with confidence >= 0.8 pass through
4. **Approval bot** sends the response to the approval group for review
5. You press **Approve**, **Reject**, or **Edit**
6. Approved messages are sent to the group with typing delay

### Proactive responses
Every 5 minutes, the proactive scanner scores unresponded threads using 5 factors: recency, unanswered questions, topic relevance, thread heat, novelty. Threads scoring above 0.5 go through the same pipeline.

### DM flow
When someone asks for links, the agent offers to send them via DM. DM approval is separate from group message approval. The agent never initiates cold DMs.

## Approval bot commands

Send these in the approval group:

| Command | Action |
|---------|--------|
| `/status` | Stats: groups, messages, contacts, responses |
| `/groups` | List all groups with status |
| `/digest` | Topic digest for the last 7 days. `/digest 3` for 3 days |
| `/leads` | Top 10 contacts by relevance. `/leads 20` for top 20 |
| `/pause` | Pause all responses |
| `/resume` | Resume responses |
| `/note <chat_id> <text>` | Save a note for a group |
| `/forget <user_id>` | Delete a contact |

## Monitoring

### Health check

The container has a Docker healthcheck that verifies the agent is alive every 60 seconds. An `autoheal` container automatically restarts it if unhealthy.

```bash
docker inspect tg-growth-agent --format='{{.State.Health.Status}}'
```

### Alerts

The bot sends alerts to the approval group:
- Claude API rate limit hit (with reset time)
- Claude auth errors
- Kicked/banned/muted from a group

## Project structure

```
src/
├── config.py              # config loader
├── telegram/              # Telegram interaction
│   ├── listener.py        # message handler + keyword trigger + ban detection
│   ├── sender.py          # send with typing delay
│   ├── approval.py        # aiogram approval bot
│   └── joiner.py          # join groups
├── ai/                    # Claude + data sources
│   ├── responder.py       # claude -p subprocess + two-phase verification
│   ├── rag.py             # RAG API client (podcast knowledge base)
│   └── proactive.py       # proactive thread scanner
├── storage/               # data layer
│   ├── db.py              # SQLite (groups, messages, responses, contacts)
│   ├── contacts.py        # contact tracking + relevance scoring
│   ├── cleanup.py         # retention + daily resets
│   └── validatorinfo.py   # ValidatorInfo DB health check
├── core/                  # shared logic
│   ├── response_pipeline.py # shared response pipeline (reactive + proactive)
│   └── rate_limiter.py    # anti-ban checks (warmup, daily limits, delays)
└── tools/                 # CLI tools for Claude
    ├── search-rag.py      # search podcast knowledge base
    └── query-db.py        # query ValidatorInfo DB
```

## Configuration

All settings in `config.yaml`. Key parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `strategy.mode` | `approval` | `approval` (human reviews) or `auto` (not implemented) |
| `limits.messages_per_group_per_day` | `10` | Max responses per group per day |
| `limits.min_delay_per_group` | `60` | Seconds between responses in same group |
| `limits.warmup_hours_min/max` | `3/6` | Random warmup period for new groups |
| `proactive.interval_minutes` | `5` | Proactive scanner interval |
| `proactive.score_threshold` | `0.5` | Min score for proactive response |
| `claude.model` | `claude-sonnet-4-6` | Model for first response (keyword match) |
| `claude.model_reply` | `claude-opus-4-6` | Model for replies, DM, proactive |
| `claude.timeout_seconds` | `120` | Subprocess timeout |

## Customization

The agent persona is defined in `CLAUDE.md`. Edit it to change:
- Name, personality, tone
- Which resources to promote (ValidatorInfo, Podcast, B.V.C., Web3 Society)
- Conversation flow rules
- Content safety rules
- Writing style

Keywords that trigger reactive responses are in `config.yaml` under `target.topics`.
