# ai-integrations — npm package

[![npm](https://img.shields.io/npm/v/@citizenweb3/ai-integrations)](https://www.npmjs.com/package/@citizenweb3/ai-integrations)
[![AgentSkills](https://img.shields.io/badge/AgentSkills-compatible-blue)](https://agentskills.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**AI agent skills for blockchain node operators.**

Install, update, and manage blockchain validator nodes with natural language — works with Claude Code, GitHub Copilot, Gemini CLI, OpenAI Codex CLI, opencode, and OpenClaw.

---

## Install

```bash
# No install required — use npx
npx @citizenweb3/ai-integrations logos-node

# Install globally (available in all projects)
npx @citizenweb3/ai-integrations logos-node --global

# Or install the CLI globally
npm install -g @citizenweb3/ai-integrations
ai-integrations logos-node
```

---

## Usage

```bash
# Install a skill for a specific network
ai-integrations logos-node

# Install globally (available in all projects, not just current)
ai-integrations logos-node --global

# Skip confirmation prompts
ai-integrations logos-node --yes

# Help
ai-integrations --help
```

After installation, activate the skill in your AI agent:
```
/logos-node install   — fresh node setup
/logos-node update    — breaking upgrade (wipe + re-init)
/logos-node status    — check sync, peers, wallet balance
```

---

## Supported networks

| Network | Branch | Status |
|---|---|---|
| `logos-node` | [logos-node](https://github.com/citizenweb3/ai-integrations/tree/logos-node) | ✅ Available |
| `darkfi-node` | `darkfi-node` | 🔜 Planned |
| `genlayer-node` | `genlayer-node` | 🔜 Planned |

---

## Supported agents

The installer auto-detects which agents you have and asks before installing for each.

| Agent | How detected | Skill path |
|---|---|---|
| Claude Code | `~/.claude/` exists | `~/.claude/skills/<network>/` |
| GitHub Copilot | `.github/copilot/` or GitHub remote | `.agents/skills/<network>/` |
| Gemini CLI | `.gemini/` or `GEMINI_API_KEY` | `.gemini/skills/<network>/` |
| OpenAI Codex CLI | `OPENAI_API_KEY` or `.codex/` | `.agents/skills/<network>/` |
| opencode | `.opencode/` or `which opencode` | `.opencode/skills/<network>/` |
| OpenClaw | `~/.openclaw/` or `which openclaw` | `~/.openclaw/skills/<network>/` |

With `--global`, skills are installed to home directory paths so they're available in all projects.

---

## How skills work

Skills are markdown files that tell an AI agent how to perform a complex task.
When you type `/logos-node install`, your agent reads `skill/SKILL.md` and
follows the step-by-step procedure to set up your Logos node.

Key feature: **the skill fetches the latest Logos release at runtime** via GitHub API.
No manual updates needed when a new Logos version ships.

---

## Claude Code marketplace

```
/plugin marketplace add citizenweb3/ai-integrations
/plugin install logos-node@citizenweb3
```

---

## Alternative: bash installer (no npm)

```bash
curl -fsSL https://raw.githubusercontent.com/citizenweb3/ai-integrations/logos-node/install.sh | bash
```

---

## Contributing

- Skills are in network branches (`logos-node`, `darkfi-node`, ...)
- Installer is in `main` branch
- Open a PR against the relevant branch to update a skill

---

## About

Built by [CitizenWeb3](https://github.com/citizenweb3) as a public contribution to blockchain node operator tooling.

[citizenweb3/ai-integrations](https://github.com/citizenweb3/ai-integrations) · [AgentSkills Standard](https://agentskills.io) · [MIT License](LICENSE)
