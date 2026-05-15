# AI Integrations — CitizenWeb3

Index of CitizenWeb3 AI agents. This `main` branch carries only this README; each agent lives on its own long-running branch in this repo, in a sibling repo, or locally.

## Agents at a glance

| Agent | Location | Purpose | Stack | Status |
|---|---|---|---|---|
| **Aida** — Telegram Growth Agent | this repo, branch [`aida-trust-first-rewrite`](https://github.com/citizenweb3/ai-integrations/tree/aida-trust-first-rewrite) | Autonomous Telegram agent: joins Web3/staking/privacy groups, answers via ValidatorInfo + CW3 podcast RAG, grows community | Python 3.12, Telethon, aiogram, Postgres, Claude Code CLI, Docker | Active |
| **AI Tools Landing** | this repo, branch [`ai-landing`](https://github.com/citizenweb3/ai-integrations/tree/ai-landing) | Public landing for CW3 AI tools | Next.js, TypeScript, Framer Motion, Tailwind | Active |
| **Logos Chatbot** | this repo, branch [`logos-onboarding-assistant`](https://github.com/citizenweb3/ai-integrations/tree/logos-onboarding-assistant) · [logos.staking.citizenweb3.com](https://logos.staking.citizenweb3.com) | RAG chatbot for the Logos network — onboarding assistant for users, developers, and validators | Next.js 16, AI SDK, Drizzle, Postgres, Redis, Vertex AI | Active |
| **Logos Node Skill** | this repo, branch [`logos-node`](https://github.com/citizenweb3/ai-integrations/tree/logos-node) | AI agent skill: install, update, and operate a Logos Blockchain testnet validator node from natural language | Node.js, bash, systemd, npx | Active |
| **AI Integrations CLI** | this repo, branch [`installer`](https://github.com/citizenweb3/ai-integrations/tree/installer) | npm CLI (`@citizenweb3/ai-integrations`) that installs agent skills into Claude Code, GitHub Copilot, Gemini CLI, Codex CLI, opencode, OpenClaw | Node.js, npm | Active |
| **Upwork Agent** | [citizenweb3/upwork-agent](https://github.com/citizenweb3/upwork-agent) | Autonomous Upwork job search + scoring + proposal drafting + submission, human-in-the-loop via Telegram | Node.js, Chrome DevTools Protocol, Claude Code CLI, Telegram bot, Docker | Active |
| **ValidatorInfo — RAG Assistant** | [citizenweb3/validatorinfo](https://github.com/citizenweb3/validatorinfo) | In-product RAG endpoint over CW3 podcasts + on-chain validator data; serves `/api/rag/search` consumed by Aida, Content Creator, Bizdev Email Agent | Next.js API route, Postgres, Prisma | Active |
| **ValidatorInfo — Fullstack Developer** | [citizenweb3/validatorinfo](https://github.com/citizenweb3/validatorinfo) (`agents-infrastructure/`) | Self-hosted GitHub Actions runner that ships features/fixes against the ValidatorInfo codebase via Claude Code | Docker, GitHub self-hosted runner, Claude Code CLI, DeepContext MCP, GitNexus MCP, Figma MCP | Active |
| **ValidatorInfo — Content Creator** | [citizenweb3/validatorinfo](https://github.com/citizenweb3/validatorinfo) (`agents-infrastructure/`) | Two self-hosted runners (per-brand) generating and publishing content to Twitter / Telegram / Discord from indexed data | Docker, GitHub self-hosted runner, Claude Code CLI, Twitter API, Telegram, Discord webhooks | Active |
| **Bizdev Email Agent** | local, not yet published | Autonomous outreach: prospect discovery, research, personalized cold drafting, Telegram approval, Resend send, reply capture, self-improvement via embeddings | Next.js dashboard, TypeScript worker, Postgres + pgvector, Drizzle, Resend, Telegram bot, Apollo.io, Hunter.io | WIP (local) |

---

## Aida — Telegram Growth Agent

Autonomous agent for CitizenWeb3. Joins Web3/staking/privacy Telegram groups, answers questions using real on-chain data (ValidatorInfo) + CW3 podcast RAG, posts under human approval.

**Architecture**: `main.py` event loop → Telethon listens to groups → trust gates filter messages → Claude CLI generates reply → approval bot (aiogram) routes to operator → on approval, posts back. Postgres stores history; healthcheck + autoheal keep container alive.

**Branches**:

| Branch | Role | Last activity |
|---|---|---|
| [`aida-trust-first-rewrite`](https://github.com/citizenweb3/ai-integrations/tree/aida-trust-first-rewrite) | **Canonical.** Trust-first rewrite — always-Phase-2 trust gates, post-Phase-2 hard gate, hostility/defensiveness handling | latest |
| [`tg-growth-agent`](https://github.com/citizenweb3/ai-integrations/tree/tg-growth-agent) | Original mainline before rewrite | 3 weeks ago |
| [`tg-growth-agent-llama`](https://github.com/citizenweb3/ai-integrations/tree/tg-growth-agent-llama) | Experimental: Ollama Qwen3-30B-A3B as pre-filter to cut Claude calls | 3 weeks ago |
| `prompt-extraction-refactor` | Local-only refactor branch (not pushed) — prompt extraction, drops `already_offered` tracking | 2 weeks ago |

---

## AI Tools Landing

Public-facing landing page presenting CitizenWeb3 AI tools/agents.

**Architecture**: single-page Next.js App Router (`src/app/page.tsx`) with Framer Motion animations, Tailwind v4 styling, Lucide icons. No backend, no auth, no DB.

**Branches**:

| Branch | Role | Last activity |
|---|---|---|
| [`ai-landing`](https://github.com/citizenweb3/ai-integrations/tree/ai-landing) | **Canonical.** Original landing build | 6 weeks ago |
| [`ai-landing-dev`](https://github.com/citizenweb3/ai-integrations/tree/ai-landing-dev) | Design + copy refresh, not yet merged back | 3 weeks ago |

---

## Logos Chatbot

Live: **[logos.staking.citizenweb3.com](https://logos.staking.citizenweb3.com)** · Branch: [`logos-onboarding-assistant`](https://github.com/citizenweb3/ai-integrations/tree/logos-onboarding-assistant)

RAG chatbot for the [Logos](https://logos.co) network. Onboarding assistant for three audiences: end users (network basics, getting started), developers (building on Logos), and validators (running infrastructure). Answers grounded in indexed Logos documentation and ecosystem sources.

**Architecture**: Next.js 16 App Router + AI SDK v6 (`@ai-sdk/google-vertex`, Gemini provider). Drizzle ORM over Postgres (pgvector) for chat logs, sources, chunks. Redis (ioredis) for caching and rate limiting. Background `indexer/` process ingests sources → chunks → embeddings on a cron schedule. Services in `src/app/services/`: `chat-log-service`, `chunk-service`, `rate-limit-service`, `source-service`, `retrieval-service`, `rerank-service`. Fully containerised via Docker Compose (`app`, `indexer`, `postgres`, `redis`).

**Data sources indexed**: logos.co, build.logos.co, docs.waku.org, press.logos.co, blog.nomos.tech; GitHub orgs `logos-co` and `logos-blockchain`; curated raw GitHub docs (logos-docs, logos-lips, logos-blockchain-specs).

---

## Agent Skills

### Logos Node Skill

Branch: [`logos-node`](https://github.com/citizenweb3/ai-integrations/tree/logos-node)

AI agent skill that lets you install, update, and operate a Logos Blockchain testnet validator node using natural language inside any supported AI agent.

**Commands**:

| Command | Action |
|---|---|
| `/logos-node install` | Fresh node installation: binary, circuits, systemd service, faucet |
| `/logos-node update` | Breaking upgrade: wipe state, re-init, restart with new binary |
| `/logos-node status` | Check sync mode, peers, block height, wallet balance |

**Install**:

```bash
npx @citizenweb3/ai-integrations logos-node
```

**Requirements**: Linux x86_64, glibc ≥ 2.39 (Ubuntu 24.04+ / Debian 12+), ≥ 64 GB free storage, root/sudo.

### AI Integrations CLI (installer)

Branch: [`installer`](https://github.com/citizenweb3/ai-integrations/tree/installer) · npm: [`@citizenweb3/ai-integrations`](https://www.npmjs.com/package/@citizenweb3/ai-integrations)

npm package + CLI that installs Citizen Web3 agent skills into any supported AI coding agent. Auto-detects installed agents and asks before writing to each.

**Supported agents**:

| Agent | Skill path |
|---|---|
| Claude Code | `~/.claude/skills/<network>/` |
| GitHub Copilot | `.agents/skills/<network>/` |
| Gemini CLI | `.gemini/skills/<network>/` |
| OpenAI Codex CLI | `.agents/skills/<network>/` |
| opencode | `.opencode/skills/<network>/` |
| OpenClaw | `~/.openclaw/skills/<network>/` |

**Available skills**:

| Skill | Status |
|---|---|
| `logos-node` | ✅ Available |
| `darkfi-node` | 🔜 Planned |
| `genlayer-node` | 🔜 Planned |

---

## Upwork Agent

Repo: [citizenweb3/upwork-agent](https://github.com/citizenweb3/upwork-agent)

Autonomous Upwork job-search and proposal agent powered by Claude Code. Background daemon ties three components together: a logged-in Google Chrome session (via Chrome DevTools Protocol), a Telegram bot for human-in-the-loop control, and Claude Code as the browsing/scoring/writing brain.

**Architecture**: cron tick (or `/search`) → Claude Code drives Chrome, scrapes job listings → scores each job 0-10 against operator's profile → jobs ≥ 6 sent to Telegram as cards with inline buttons (`Apply` / `Skip`) → on `Apply`, Claude generates a proposal matching operator's writing style → operator reviews (`Send` / `Cancel` / `Redo`) → on `Send`, Claude submits via the same Chrome session. Two run modes: Docker (server, headless, Chrome via noVNC at `:6080`) and bare-metal (Mac/Linux desktop with native Chrome).

---

## ValidatorInfo agents

Repo: [citizenweb3/validatorinfo](https://github.com/citizenweb3/validatorinfo)

ValidatorInfo is a Web3 multi-chain explorer (Cosmos, Polkadot, Ethereum, Namada, Aztec, …). Three-tier system: Next.js frontend (Socket.IO + next-intl), indexer service (background cron jobs), Postgres + Prisma + Redis. Three AI agents live alongside the product — one in-app (RAG Assistant) and two as self-hosted GitHub Actions runners (`agents-infrastructure/`).

### RAG Assistant

In-product RAG endpoint at `src/app/api/rag/search/`. Indexes the CitizenWeb3 podcast corpus + on-chain validator data; serves chat responses inside ValidatorInfo and exposes `RAG_API_URL` + `RAG_API_TOKEN` for external clients (Aida, Bizdev Email Agent, Content Creator). Single internal API surface — `/api/rag/search` — consumed across the agent fleet.

### Fullstack Developer Agent (`agent-builder`)

Self-hosted GitHub Actions runner (label `self-hosted,builder`) that picks up workflow jobs against the ValidatorInfo repo and ships features/fixes via Claude Code. Wired with full project context: `DATABASE_URL` + `EVENTS_DATABASE_URL` (read access to validator + events DBs), `WILDCARD_API_KEY` (DeepContext semantic code search), GitNexus for code-relationship/impact analysis, `FIGMA_ACCESS_TOKEN` for design pulls, `GH_TOKEN` for PR operations. Persistent volumes hold `~/.claude` state, runner state, workspace, and GitNexus cache across runs.

### Content Creator (`agent-content` + `agent-content-cw3`)

Two parallel content-publishing runners — one per brand:
- `agent-content` → ValidatorInfo (`@therealvalinfo`)
- `agent-content-cw3` → CitizenWeb3 (`@citizen_web3`)

Each is a self-hosted runner triggered by GitHub workflows, generating content from indexed data and publishing to Twitter (OAuth1 + OAuth2), Telegram channel, and Discord webhook. Pulls source material via the RAG Assistant (`RAG_API_URL`) and the validator DB. Helper scripts in `agents-tools/`: `post-twitter.js`, `post-telegram.js`, `post-discord.js`, `search-rag.js`, `log-social.sh`. Brand isolation enforced via separate Twitter/Telegram/Discord credentials and separate runner workspaces.

---

## Bizdev Email Agent

Status: **WIP, local-only.** No public repo yet. MVP scaffold in `~/project/dev/bizdev-email-agent`.

Autonomous outbound campaign agent for CitizenWeb3. End-to-end pipeline: prospect discovery → research/enrichment → personalized drafting → operator approval → send → reply capture → tracking → self-improvement via email embeddings.

**Architecture**: Next.js operator dashboard (SSR) + TypeScript worker with Postgres-backed leasing (`commands` / `jobs` / `job_runs` / `event_log` / `work_items`) + Postgres + pgvector + Drizzle. Cascading prospect discovery (webread → GitHub → Apollo.io → Hunter.io) with confidence protocol (≥ 80 % to draft). Sonnet first draft + Opus on redo. Telegram approval (aiogram) — batch + single review. Resend for outbound on `partner@citizenweb3.com` + Resend Inbound webhook + Cloudflare Email Routing for replies. ValidatorInfo Postgres (read-only) + RAG API (`/api/rag/search`) as data sources. Email embeddings (sqlite-vec / embeddinggemma-300m) for self-improving drafts.

**Two pillars**:
- **Staking Growth** — VCs, foundations, DAOs, HNW stakers → migrate delegations to CW3 bare-metal validators.
- **AI Workforce** — projects, explorers, wallets, DAOs ($1M+ TVL) → sell autonomous AI agent architecture (ValForge + specialized agents), ValidatorInfo as live flagship.

**Multi-touch model**:
- **Cold** — first-touch after research + confidence check.
- **Warm** — agent drafts replies to inbound responses; operator approves via Telegram.
- **Direct** — operator's manual replies routed through Telegram bot → Resend, thread stays on `partner@citizenweb3.com`.
- Roadmap: follow-up sequences (5/12/20-day), warm-reply automation, multi-channel (Twitter/TG/Discord/LinkedIn DMs).

---

## License

[MIT](./LICENSE) © Citizen Web3

---

## Links

- Org: https://github.com/citizenweb3
- This repo: https://github.com/citizenweb3/ai-integrations
- ValidatorInfo: https://github.com/citizenweb3/validatorinfo
- Upwork Agent: https://github.com/citizenweb3/upwork-agent
